# Report Ottimizzazioni — T-Hub Workforce Planner

Data analisi: 2026-07-02 · Le voci sono ordinate per impatto stimato. I riferimenti sono `file:riga`.

## Stato interventi (aggiornato 2026-07-03)

Applicati: 1.1 (bulk + cache TTL 15 min), 1.3 (contesto calendario condiviso + anomalie riusate),
1.4 (query distinct/aggregate per overview e link commesse/CdC), 1.5 (gerarchia in `services/hierarchy.py`,
una query + BFS in memoria, dedupe delle 3 copie), 2.1 parziale (via 1.5), 2.2 (SMTP in thread separato),
2.3 (ETag + Cache-Control sul backend, avatar react-query in EmployeesPage/OrgChartPage),
2.4 (route lazy + pdf-lib caricata all'export), 2.6 (filtro in SQL), 2.8 (indici compositi additivi
`IF NOT EXISTS` in `db.py`), 3.6 (node:20), 3.7 (creato `docker-compose.prod.yml` + `nginx/prod.conf`).

Non applicati (richiedono decisioni/lavoro maggiore): 1.2 (paginazione + filtri timesheet in SQL completi),
1.6 (cache per-request di `build_auth_user_read`), 2.5/3.x Alembic (evitato: gestione schema da pianificare,
i dati su DB sono reali), 2.7 (hash foto in sync TMS), 3.9/3.10 (split schemas e refactor pagine grandi).

---

## 1. Critiche (impatto alto, visibile agli utenti)

### 1.1 `/employees/course-badges`: una connessione SQL Server per ogni dipendente
`backend/app/api/employees.py:410-437` + `backend/app/services/tms.py:211-260`

L'endpoint lancia `fetch_employee_expirations_from_tms(tms_id)` per **ogni dipendente attivo** in un
`ThreadPoolExecutor(max_workers=8)`. Ogni chiamata apre una **nuova connessione pytds** verso il
database SGAM ed esegue una query singola. Con ~100-200 dipendenti sono 100-200 connessioni + query
per una singola apertura della pagina Dipendenti/Organigramma (entrambe le pagine lo chiamano).

**Suggerimento:**
- Un'unica query con `WHERE S.CODICE IN (...)` (o senza filtro, con raggruppamento in Python).
- Cache lato backend con TTL (es. 15-60 min): le scadenze corsi cambiano raramente.
- In alternativa, sincronizzare le scadenze in una tabella locale durante il sync dipendenti.

### 1.2 Filtri timesheet applicati in Python invece che in SQL, senza paginazione
`backend/app/services/timesheets.py:707-736` (`_query_days`) e `:917-985` (`list_timesheet_days_payload`)

`_query_days` carica **tutte** le giornate del range con slot, worker, dipendente e utente approvatore
(eager load completo); poi reparto, stato, commessa, centro di costo e ricerca testuale vengono filtrati
riga per riga in Python, costruendo per ogni giornata un "search blob" con ordinamenti e lookup ripetuti.
Nessun endpoint di lista ha `LIMIT`/paginazione.

**Suggerimento:** spostare i filtri su SQL (`ilike`, `EXISTS` sugli slot), aggiungere paginazione
(`limit`/`offset` o cursor) e restituire i conteggi con query aggregate.

### 1.3 Dashboard timesheet: stesso lavoro ripetuto 5 volte
`backend/app/services/timesheets.py:739-824`

`build_timesheet_dashboard` chiama `_build_calendar_rows` 5 volte sugli stessi `calendar_days` (una per
bucket), ricostruendo ogni volta il lookup `(worker_id, date)` e la lista date. Inoltre
`_build_day_payload` (`:620-660`) **ricalcola** `_anomaly_reasons` a ogni serializzazione benché il
risultato sia già persistito su `day.anomaly_reasons`.

**Suggerimento:** costruire il lookup calendario una sola volta e riusare `day.anomaly_reasons` salvato.

### 1.4 `build_admin_overview` e link commesse caricano intere tabelle in memoria
`backend/app/services/timesheets.py:1397-1423`, `:1448-1485`, `:1567-1603`

- `select(TimesheetSlot)` senza filtri carica **tutti gli slot** (con `source_payload` JSON) solo per
  contare i codici non mappati.
- `list_project_links_payload` / `list_cost_center_links_payload` iterano tutti gli slot per ricavare
  le etichette dei codici.
- `upsert_project_link` / `upsert_cost_center_link` (`:1488-1564`) richiamano l'intera
  `list_*_links_payload(db)` solo per restituire **una** riga.

**Suggerimento:** `SELECT DISTINCT project_code, MIN(project_description) ... GROUP BY project_code`
e serializzazione puntuale della singola riga aggiornata.

### 1.5 Gerarchia manager risolta con una query per nodo (N+1), in 3 copie
`backend/app/api/assignments.py:18-36`, `backend/app/services/timesheets.py:365-383`,
`backend/app/services/absence_permissions.py:35-48`

La BFS sui riporti esegue una `SELECT` per ogni dipendente della catena, a ogni richiesta planner/
timesheet/assenze. La stessa funzione è duplicata in tre punti.

**Suggerimento:** una sola query `SELECT id, manager_employee_id FROM employees WHERE is_active` e BFS
in memoria (o CTE ricorsiva Postgres), estratta in un modulo condiviso.

### 1.6 `build_auth_user_read` rieseguito più volte per richiesta
`backend/app/services/portal_auth.py:143-162` + `backend/app/api/deps.py`

Ogni dipendenza (`require_admin`, `get_impersonation_employee`, handler stesso…) richiama
`build_auth_user_read`, che a sua volta fa 2-3 query (LdapEmployee, Employee, count riporti). In endpoint
come `list_planner_employees` il calcolo avviene due volte nella stessa richiesta.

**Suggerimento:** calcolare una volta e memorizzare in `request.state` (dependency unica con cache
per-request), oppure una dependency `CurrentAuth` riusata dalle altre.

---

## 2. Rilevanti (impatto medio)

### 2.1 Approvatori di default ricalcolati per ogni riga
`backend/app/services/absence_permissions.py:61-66` (`resolve_approvers`)

`list_justifications` (`justifications.py:133`) e `get_approver_dashboard` (`dashboard.py:330-336`)
chiamano `resolve_approvers` per ogni giustificativo: ogni chiamata può fare fino a 2 query per gli
approvatori di default (TMS id 85/86), che sono costanti. → risolverli una volta per richiesta.

### 2.2 Email SMTP inviate in modo sincrono nel percorso della richiesta
`backend/app/services/email.py:140-163`

`notify_approvers_new_request` invia un'email per approvatore con timeout 10 s ciascuna, dentro la
richiesta HTTP di creazione assenza. Tre approvatori con SMTP lento = risposta bloccata fino a ~30 s.
→ usare `BackgroundTasks` di FastAPI (o una coda) per l'invio.

### 2.3 Foto dipendenti: nessuna cache HTTP e pattern di fetch incoerente
`backend/app/api/employees.py:464-471`; frontend `EmployeesPage.jsx:303-330`, `PlannerPage.jsx:236-246`,
`CalendarPage.jsx:663`, `OrgChartPage.jsx:559`

- Il backend restituisce il BYTEA senza `Cache-Control`/`ETag`: ogni pagina riscarica tutte le foto.
- `PlannerPage`/`CalendarPage` usano react-query con `staleTime` 30 min (bene); `EmployeesPage` e
  `OrgChartPage` usano `useEffect` manuale senza cache condivisa: N richieste a ogni mount.

**Suggerimento:** header `Cache-Control: private, max-age=86400` + `ETag` (hash della foto) lato
backend; un unico componente `EmployeeAvatar` condiviso basato su react-query lato frontend.

### 2.4 Nessun code-splitting delle route e librerie PDF nel bundle iniziale
`frontend/src/App.jsx:7-24`, `frontend/src/pages/PlannerPage.jsx:3-4`

Tutte le 18 pagine (PlannerPage 2 402 righe, EmployeesPage 2 132, CalendarPage 1 904…) sono importate
staticamente; `pdf-lib` + `@pdf-lib/fontkit` (usati solo per l'export PDF del planner) finiscono nel
bundle iniziale.

**Suggerimento:** `React.lazy`/`Suspense` per le route; `await import("pdf-lib")` dentro il handler
di export.

### 2.5 `ensure_schema_updates`: ~60 statement DDL/DML a ogni avvio
`backend/app/db.py:57-271` + `init_db:401-414`

A ogni startup vengono ispezionate tutte le tabelle, eseguiti `ALTER TABLE IF ...` a mano, seed,
backfill e `propagate_org_inheritance` su tutti i dipendenti. Oltre alla lentezza in avvio, è fragile
con più repliche in parallelo.

**Suggerimento:** migrare ad Alembic; i seed/backfill diventano migrazioni one-shot.

### 2.6 `/employees/options` con `authorized_for_absence` filtra in Python
`backend/app/api/employees.py:325-354`

Carica tutti i dipendenti e poi filtra sull'insieme `allowed_employee_ids` (che a sua volta può aver
caricato tutti gli id). → `WHERE Employee.id IN (...)` direttamente nella query.

### 2.7 Sync TMS: conversione foto sempre rieseguita
`backend/app/services/tms.py:117-208` e `:263-354`

Ogni sync scarica e riconverte tutte le foto (Pillow, resize 64×64) anche se identiche.
→ confrontare un hash del blob sorgente prima di riconvertire; valutare colonne separate/lazy per non
caricare `photo_jpeg` in ogni `SELECT *` su Employee.

### 2.8 Indici compositi mancanti sulle query calde
`backend/app/models.py`

Le query più frequenti filtrano per coppie: `assignments (work_date, employee_id)`
(`assignments.py:145-155`), `justifications (employee_id, start_date, end_date)`
(`justifications.py:64-70`, dashboard). Esistono solo indici su singole colonne.
→ aggiungere indici compositi (via migrazione).

---

## 3. Minori

| # | Dove | Problema | Suggerimento |
|---|------|----------|--------------|
| 3.1 | `timesheets.py:1784-1787` (`_upsert_workers`) | disattivazione worker uno a uno in loop | singolo `UPDATE ... WHERE external_id NOT IN (...)` |
| 3.2 | `db.py:274-296` (seed) | 2 query per elemento seed | una `SELECT` con `IN` per il set completo |
| 3.3 | `employees.py:509-511` e simili | dopo `db.commit()` si fanno `db.refresh()` **e** una seconda `get_employee_with_relationships` | basta la seconda query, il refresh è ridondante |
| 3.4 | `justifications.py:170,212,236` | dopo il commit si ricarica il giustificativo con `get_justification_or_404` | usare l'oggetto in sessione con `selectinload` già presente |
| 3.5 | `daily_records`/`activity_records` list | `limit` di default 200 ma nessun tetto massimo lato server sui range | validare range/limite massimo |
| 3.6 | `frontend/Dockerfile` | base `node:18-alpine` (EOL aprile 2025) | passare a `node:20-alpine` o `22-alpine` |
| 3.7 | `docker-compose.yml` | backend con `--reload` e bind-mount, frontend servito dal dev-server Vite dietro nginx | per la produzione: build statica frontend (target già presente nel Dockerfile) e uvicorn multi-worker senza reload; aggiungere `restart: unless-stopped` e healthcheck a backend/nginx |
| 3.8 | `models.py` colonne `JSON` | SQLAlchemy `JSON` genera `JSON`, mentre il DDL manuale usa `JSONB` (incoerenza) | usare `sqlalchemy.dialects.postgresql.JSONB` nei modelli |
| 3.9 | `schemas.py` (1 471 righe, 96 classi) | file monolitico, tempi di import e navigazione | split per dominio (`schemas/employees.py`, `schemas/timesheets.py`, …) |
| 3.10 | `PlannerPage.jsx` | pagina da 2 402 righe con ~20 `useState` e molti `useMemo` concatenati | estrarre sotto-componenti (timeline, dialog, export PDF) e hook dedicati |

---

## Sintesi priorità

1. **course-badges** (1.1) — il collo di bottiglia peggiore, tocca due pagine molto usate.
2. **Filtri timesheet in SQL + paginazione** (1.2, 1.3, 1.4) — scala male con i dati che crescono.
3. **N+1 gerarchia manager + auth ripetuta** (1.5, 1.6, 2.1) — costo fisso su quasi ogni richiesta.
4. **Email in background** (2.2) e **cache foto** (2.3) — quick win a basso rischio.
5. **Code-splitting frontend** (2.4) — migliora il primo caricamento per tutti.

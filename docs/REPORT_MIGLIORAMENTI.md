# Report Suggerimenti di Miglioramento — T-Hub Workforce Planner

Data analisi: 2026-07-02 · Complementare al `REPORT_OTTIMIZZAZIONI.md` (che copre le prestazioni):
qui sicurezza, correttezza, architettura e manutenibilità. I riferimenti sono `file:riga`.

## Stato interventi (aggiornato 2026-07-03)

Applicati: 1.1 (file rimosso — **ruotare la credenziale se reale**), 1.2 (azione solo su POST),
1.3 (endpoint timer/record → `require_timesheets_access`, mutazioni field-definitions →
`require_organization_access`), 1.4 (controllo employee_id su /dashboard/me e /approver),
1.5 (guardia all'avvio fuori da development + `compare_digest`), 1.6 (rate limit in-memory sui login),
1.10 (audit con actor reale), 2.1 (le rifiutate non bloccano più), 2.2 (notifica per ogni richiesta
pendente), 2.3 (`services/timeutils.py`, Europe/Rome), 2.4 (`DomainError` → 400 via handler),
2.5 (codice sync AWS rimosso), 2.6 (config rimossa), 3.2 parziale (dedupe gerarchia, dependency
local-user, serializer note giornaliere), 3.5 parziale (lifespan al posto di on_event),
3.6 parziale (ErrorBoundary, avatar unificati su react-query), 3.7 parziale (.env.example allineato,
compose di produzione).

Applicati nel secondo giro (2026-07-03): 3.1 Alembic (setup completo, baseline `0001_baseline` con
auto-stamp in `init_db` — solo la riga di versione, nessun dato toccato; da qui in poi le modifiche di
schema passano da `alembic revision --autogenerate` + `alembic upgrade head` nel container backend);
1.7 parziale (endpoint `/auth/refresh` + rinnovo silenzioso nel frontend ogni 30 min: la scadenza JWT
può ora essere ridotta via `JWT_EXPIRE_MINUTES`); 1.8 (chiamate Gesap proxate dal backend con
autenticazione su `/api/gesap/prenotazioni`, location nginx aperta rimossa); 1.11 predisposto
(`nginx/prod-tls.conf.example` con istruzioni — servono i certificati); 3.3 (suite pytest in
`backend/tests/`, 16 test verdi su Python 3.12 + SQLite in-memory: permessi, IDOR dashboard, rate
limit, overlap assenze, email-approval senza side effect su GET, auth local-user); 3.4 (workflow
GitHub Actions `.github/workflows/ci.yml` con ruff+pytest+build frontend, config ruff in
`backend/pyproject.toml`, lint pulito); 3.2 duplicati risolti (la versione migliorata di
`insert_ferie.py` è ora `backend/insert_ferie.py`, copia root rimossa; `THubLogin.jsx` root rimosso,
resta la versione integrata in `frontend/src/`). Fix aggiuntivo emerso dai test: confronto
naive/aware in `is_local_user_password_expired`.

Restano non applicati: 1.7 completo (cookie httpOnly — richiede rework dei client mobile),
1.9 (query TMS parametrizzate — le query sono configurabili da env, cambiare formato romperebbe
le installazioni esistenti), split di `schemas.py` e refactor delle pagine monolitiche (rework ampio
da fare gradualmente con la CI ora disponibile).

---

## 1. Sicurezza (priorità alta)

### 1.1 File `$PaT0n2024` nella root del repository
`/opt/thub/$PaT0n2024` (file vuoto, non tracciato ma visibile in `git status`)

Ha tutto l'aspetto di una **password finita per errore in un nome file** (es. redirect di shell
`comando > $PaT0n2024` senza quoting). Da eliminare subito e, se corrisponde a una credenziale reale
(utente DB/TMS/portale), **ruotarla**: chiunque abbia accesso alla macchina o a un backup della
directory la vede.

### 1.2 Azione approva/rifiuta eseguita su richiesta GET
`backend/app/api/email_approvals.py:121-183`

`GET /email-approvals/{token}?action=approved` **applica subito** l'approvazione. Le email contengono
proprio questi link (`email.py:192-199`). Antivirus, proxy aziendali e client di posta che fanno
prefetch dei link possono approvare o rifiutare richieste **senza che l'approvatore abbia cliccato**.
Il token inoltre resta valido 3 giorni e finisce nei log HTTP.

**Suggerimento:** la GET deve solo mostrare la pagina di conferma (già esiste, con form POST);
l'azione va applicata **solo** sulla POST. Valutare token monouso (invalidazione dopo l'uso).

### 1.3 Endpoint "admin" protetti solo da autenticazione generica
- `backend/app/api/activity_records.py:301-360`: `/activity-records/active/admin*` (vedere, chiudere,
  eliminare i timer di **qualsiasi** dipendente) e `:430-463` `/admin`, `/admin/stats` richiedono solo
  `get_current_user`: qualunque utente LDAP abilitato al login può usarli.
- `backend/app/api/field_definitions.py:21-101`: CRUD completo delle definizioni campo con solo
  `get_current_user`.

**Suggerimento:** applicare `require_admin` (o un ruolo dedicato "timesheet admin") a questi router.

### 1.4 IDOR su dashboard personali
`backend/app/api/dashboard.py:216-222` (`/dashboard/me`) e `:313-336` (`/dashboard/approver`)

`employee_id` arriva come query param e non viene confrontato con il dipendente collegato all'utente
autenticato: qualunque utente loggato può leggere pianificazione, assenze (anche future e pendenti) e
coda approvazioni di **qualsiasi** dipendente cambiando l'id.

**Suggerimento:** derivare l'employee dal token (`get_linked_tms_employee`) e ignorare/validare il
parametro; consentire id arbitrari solo ad admin/HR.

### 1.5 Credenziali e segreti di default
`backend/app/config.py:10-15`

`jwt_secret_key = "change-this-in-production"`, `app_username/app_password = admin/admin`. Se il `.env`
non li sovrascrive, chiunque può forgiare JWT validi o entrare come utente portale (che ha ruolo
**admin**, `portal_auth.py:190-199`). Il confronto password del portale è in chiaro
(`portal_auth.py:211`).

**Suggerimento:** all'avvio, se `app_env != "development"`, rifiutare di partire con i valori di
default; hash (bcrypt/scrypt) anche per la password del portale; valutare la rimozione completa del
login da env in favore di un utente admin su DB.

### 1.6 Nessuna protezione brute-force sul login
`backend/app/api/auth.py:36-41`, `:144-161`

Né `/auth/login` (LDAP + env) né `/auth/local-user/login` hanno rate limiting, lockout o delay.
Con LDAP c'è anche il rischio di lockout AD indotto da terzi. → rate limit (slowapi o `limit_req`
su nginx) + audit degli insuccessi (oggi si logga solo il successo).

### 1.7 Token JWT in `localStorage`, 8 ore, senza refresh/revoca
`frontend/src/api.js:45-56`, `backend/app/config.py:12`

Un XSS qualsiasi esfiltra un token valido 8 ore; non esiste lista di revoca né refresh token.
→ valutare cookie `httpOnly` + CSRF, oppure expiry breve (15-30 min) con refresh; alla disattivazione
utente il token resta comunque valido fino a scadenza (mitigato dal check `is_active` su ogni
richiesta — bene — ma solo per gli endpoint che passano da `get_current_user`).

### 1.8 Proxy verso servizio interno non autenticato
`nginx/default.conf` (location `/gesap-proxy/`), `frontend/src/pages/PlannerPage.jsx:370-375,1966`

nginx espone `http://192.168.24.21/gesap_dev/sito/api/` ("prenotazioni_domani_**senza_login**.php") a
chiunque raggiunga la porta 8088, senza autenticazione. Inoltre il link diretto a
`http://192.168.24.21/...` hardcoded nel frontend non passa dal proxy (non funziona fuori LAN e
mischia origini). → far transitare la chiamata dal backend con autenticazione, o proteggere la
location; niente IP hardcoded nel client.

### 1.9 Query SQL esterne costruite per interpolazione e configurabili da env
`backend/app/config.py:32-77`, `:100-107`

Le query TMS/stocktonoli sono stringhe in config con `.format(...)` e escaping manuale degli apici
(`replace("'", "''")`). Funziona, ma è fragile: meglio parametri bind di pytds (`%s`) e query non
sovrascrivibili da variabile d'ambiente (o almeno whitelist delle colonne attese).

### 1.10 Audit log con `actor_name="system"` per azioni utente
`backend/app/api/employees.py:497-507,549-555,583-589,628-634,660-670,702-712,741-751,770-776,811-821`

Tutte le modifiche ai dipendenti (manager, permessi assenze, ruoli app, utenze locali…) vengono
registrate come `system`: l'audit trail non dice **chi** ha fatto la modifica, pur avendo
`current_user` disponibile. → passare `actor_name=current_user.username, user_id=current_user.id`.

### 1.11 Assenza di HTTPS
`docker-compose.yml`, `nginx/default.conf`

Tutto viaggia in HTTP sulla porta 8088 (credenziali LDAP incluse, che sono le password di dominio).
→ terminare TLS su nginx (anche con certificato interno) o davanti (reverse proxy aziendale).

---

## 2. Correttezza / bug funzionali

### 2.1 Una richiesta rifiutata blocca la ripresentazione per lo stesso periodo
`backend/app/api/justifications.py:59-79` (`ensure_no_duplicate_justification`)

Il controllo sovrapposizione non esclude i giustificativi con `approval_status = rejected`: se una
richiesta ferie viene rifiutata, il dipendente riceve 409 quando prova a richiedere di nuovo lo stesso
periodo (magari con date corrette). → aggiungere
`Justification.approval_status != JustificationApprovalStatus.rejected` al filtro.

### 2.2 Notifica approvatori inviata solo per le richieste "per sé stessi"
`backend/app/api/justifications.py:171-173`

`notify_approvers_new_request` parte solo se `requesting_for_self`; se un manager inserisce
un'assenza **pendente** per un collaboratore, nessun approvatore riceve l'email (la richiesta resta
in attesa in silenzio). Se è voluto, documentarlo; altrimenti notificare quando
`approval_required` è vero, indipendentemente dal richiedente.

### 2.3 Date "oggi" calcolate nel fuso del server
`backend/app/api/auth.py:251`, `employees.py:358`, `daily_records`/`activity_records` vari

`date.today()` usa il timezone del container (UTC di default in `python:3.12-slim`): tra mezzanotte e
le 2 di notte ora italiana i confini giornata (dashboard, record presenze, unique
`uq_daily_record_employee_date`) slittano. → usare `ZoneInfo("Europe/Rome")` in modo esplicito o
passare la data dal client dove già previsto.

### 2.4 Errori di dominio come `RuntimeError` → HTTP 500
`backend/app/services/timesheets.py:1340,1349,1491,...` vs `api/timesheets.py`

`update_worker_link` & co. sollevano `RuntimeError` per casi utente ("già collegato a un altro
operatore"): dove il router non li cattura diventano 500 generici. → eccezioni di dominio dedicate
mappate su 400/409 con un exception handler FastAPI.

### 2.5 Codice morto della sincronizzazione AWS
`backend/app/services/timesheets.py:1852-1862`, `main.py:19-27`, `build_admin_overview:1410-1413`

`sync_timesheets` solleva "Sincronizzazione AWS rimossa", lo scheduler è un no-op ma viene ancora
avviato/fermato allo startup, l'overview admin riporta campi sync fissi a `False/0`, e in
`.env.example` resta `AWS_SYNC_BASE_URL`. → rimuovere il ramo morto (o reintrodurre la feature),
pulire schema/`TimesheetSyncRun` se non più alimentata.

### 2.6 `local_user_api_key` definita ma mai usata
`backend/app/config.py:79` (+ `.env.example`) — nessun riferimento nel codice. Rimuovere o cablare.

---

## 3. Architettura e manutenibilità

### 3.1 Migrazioni: sostituire `ensure_schema_updates` con Alembic
`backend/app/db.py:57-271` — già discusso nel report ottimizzazioni; qui conta anche per la
correttezza: gli `ALTER TABLE` manuali non sono versionati, non hanno rollback e divergono dai modelli
(es. `JSON` vs `JSONB`).

### 3.2 Duplicazioni da unificare
- `_collect_report_ids` in 3 file (`assignments.py:18`, `absence_permissions.py:35`,
  `timesheets.py:365`).
- `_get_current_local_user_employee` duplicata in `api/auth.py:121-141` e `api/deps.py:72-92`
  (`get_current_local_employee`).
- `_serialize_team_daily_note` in `api/teams.py:65` e `api/workloads.py:73`.
- Blocco team-leader/has-reports identico in `list_employees` e `list_planner_employees`
  (`employees.py:211-233` e `:309-321`).
- Root del repo: `insert_ferie.py` e `THubLogin.jsx` esistono in due copie **divergenti**
  (root vs `backend/`/`frontend/src/`). Tenere una sola copia (gli script one-shot in `scripts/`).

### 3.3 Nessun test automatico
Non esiste alcun test nel repo, a fronte di una matrice di autorizzazioni complessa (ruoli app ×
planner level × permessi assenze × impersonation) e di parser euristici (`_parse_date`, `_parse_int`,
`_normalize_timesheet_record`). Priorità:
1. test di permessi con `TestClient` (chi vede/modifica cosa) — è la parte più rischiosa;
2. unit test dei parser timesheet e di `resolve_approvers`;
3. test del flusso email-approval (token scaduto/riusato/non autorizzato).

### 3.4 Nessun tooling di qualità né CI
Mancano ruff/flake8, mypy, prettier/eslint, pre-commit e una pipeline CI. Il repo ha un solo commit
("Initial commit") con ~50 file modificati/nuovi non committati: adottare commit piccoli e frequenti
e branch di feature; la history è anche il backup del lavoro.

### 3.5 FastAPI: API deprecate e lifecycle
`backend/app/main.py:19-27` usa `@app.on_event` (deprecato) → passare al `lifespan` context manager.
`schemas.py` monolitico (1 471 righe) e `models.py` (566) → split per dominio.

### 3.6 Frontend: pattern dati incoerenti e pagine monolitiche
- Metà pagine usano react-query, l'altra metà `useEffect` manuale (es. avatar in `EmployeesPage.jsx:303`
  vs `PlannerPage.jsx:236`): standardizzare su react-query.
- `PlannerPage` (2 402 righe), `EmployeesPage` (2 132), `CalendarPage` (1 904): estrarre componenti e
  hook; `CalendarPage.css` da 2 115 righe suggerisce stili da modularizzare.
- Nessun error boundary: un errore di rendering butta giù l'intera app.
- Testi hardcoded misti italiano/inglese ("Request failed", messaggi API in italiano): uniformare
  (eventualmente un piccolo modulo i18n).

### 3.7 Configurazione e deploy
- `.env.example` non elenca `JWT_SECRET_KEY`, `APP_USERNAME/APP_PASSWORD`,
  `PUBLIC_API_BASE_URL`, `EMAIL_APPROVAL_TOKEN_EXPIRE_MINUTES`, `TMS_EXCLUDED_EMPLOYEE_IDS`: chi
  installa non sa di doverli impostare. Allinearlo a `config.py`.
- `docker-compose.yml` è di fatto una configurazione di sviluppo (reload, dev-server): creare un
  `docker-compose.prod.yml` con build statica frontend, uvicorn multi-worker, `restart` policy e
  healthcheck; pianificare il backup del volume `postgres_data`.
- Il commento in `README`/PDR e i nomi ("AWS") si riferiscono a un sistema esterno dismesso: aggiornare
  la documentazione allo stato reale (utile anche il PDR `docs/pdr-workforce-planner.md`).

### 3.8 Osservabilità
Nessuna configurazione di logging strutturato (solo `logger` in `email.py`), nessuna metrica.
Suggerimenti minimi: logging JSON con request-id, log degli errori 4xx/5xx, e un indice/politica di
retention per `audit_logs` (crescerà senza limiti; oggi manca anche un indice su `created_at`).

---

## Sintesi priorità

| Priorità | Interventi |
|----------|-----------|
| **Subito** | 1.1 file `$PaT0n2024` (+ rotazione credenziale), 1.2 approvazione su GET, 1.3 endpoint admin senza ruolo, 1.4 IDOR dashboard, 1.5 segreti default |
| **A breve** | 1.6 rate-limit login, 1.10 audit actor, 2.1 blocco richieste rifiutate, 2.2 notifiche approvatori, 3.1 Alembic |
| **Pianificabile** | 1.7 gestione token, 1.11 TLS, 2.3 timezone, 3.2 duplicazioni, 3.3 test, 3.4 CI/lint, 3.6 refactor frontend, 3.7 deploy prod |

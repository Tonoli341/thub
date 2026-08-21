# AGENTS.md — Regole operative per agenti AI su T-Hub

> **File canonico per qualsiasi agente** (Claude Code, Codex, Cursor, Copilot, Gemini CLI, Aider…).
> `CLAUDE.md` e `.github/copilot-instructions.md` puntano qui: modifica **solo questo file**.
>
> Leggilo **prima** di toccare il codice. Se una richiesta dell'utente contraddice queste
> regole, vince l'utente — ma dillo esplicitamente prima di procedere.

---

## 0. Cos'è questo progetto

T-Hub è il portale interno di workforce management di Tonoli: pianificazione turni,
rendicontazione operativa, anagrafica dipendenti, assenze, consegne DPI/dispositivi,
formazione, carichi di lavoro.

**È un sistema in produzione, con dati reali di dipendenti veri.** Non è un progetto
sperimentale. Ogni modifica va trattata come se andasse in produzione domani, perché
di norma è così.

| | |
|---|---|
| Backend | FastAPI 0.115 · SQLAlchemy 2.0 · Pydantic Settings · PostgreSQL 16 · Alembic |
| Frontend | React 18 · Vite 5 · MUI 6 · TanStack Query 5 · React Router 6 (JSX, **niente TypeScript**) |
| Infra | Docker Compose + nginx reverse proxy · app su `:8088`, backend `:8000`, vite `:5173` |
| Sistemi esterni (sola lettura) | TMS/SGAM (MSSQL), stocktonoli (MSSQL), Gesap, NinjaOne, LDAP/AD, Microsoft Graph |
| Lingua | Codice inglese, **commenti / messaggi utente / testi UI in italiano** |

### Mappa rapida

```
backend/app/
  main.py            lifespan, guard segreti produzione, handler DomainError, CORS
  config.py          Settings (pydantic-settings) + query SQL verso i sistemi esterni
  db.py              engine, get_db, init_db() e tutta la catena di seed/DDL di avvio
  models.py          modelli SQLAlchemy (PK uuid String(36) + TimestampMixin)
  enums.py           UserRole, AppRole, AssignmentCause, JustificationType…
  schemas.py         schemi Pydantic (2099 righe — modulo condiviso)
  api/               un router per dominio; __init__.py decide cosa è protetto
  api/deps.py        require_* → UNICO punto di autorizzazione
  services/          logica di dominio, integrazioni, sicurezza, audit
  migrations/        Alembic (baseline 0001, head attuale 0025_team_reporting_notifications)
  tests/             pytest su SQLite in-memory (91 test)
frontend/src/
  api.js             UNICO client HTTP (token, impersonation, 401→logout, download)
  auth.jsx           AuthProvider, refresh silenzioso ogni 30 min, impersonation
  App.jsx            routing + sidebar con gating per permesso (`requires:`)
  pages/             una pagina per route, lazy-loaded
docs/                report di analisi e specifiche di modulo
```

---

## 1. 🧊 CONGELATO — non si tocca

Modificare uno di questi elementi **senza mandato esplicito dell'utente è un errore**,
anche se il codice sembra migliorabile. Se pensi vada cambiato → passa da §2 (Proposal).

### 1.1 Segreti e configurazione
- **`.env` non si legge, non si stampa, non si committa.** È in `.gitignore`. Se ti serve
  sapere quali variabili esistono, guarda `.env.example` — che va aggiornato ogni volta
  che ne aggiungi una.
- Il guard `_ensure_production_secrets()` in [backend/app/main.py](backend/app/main.py)
  **resta**. Impedisce l'avvio fuori da development con JWT secret di fabbrica. Non
  rimuoverlo, non aggirarlo, non aggiungere ambienti alla whitelist.
- `SECRETS_ENCRYPTION_KEY`: cambiarla rende illeggibili tutti i segreti delle integrazioni
  già salvati. Non proporre rotazioni senza un piano di reinserimento dalla GUI.
- CORS: `settings.cors_origins_list`. **Mai** `allow_origins=["*"]`.

### 1.2 Database reale
- Il Postgres di questo deploy contiene dati veri. **Nessuno script distruttivo**
  (`DROP`, `DELETE` massivi, `TRUNCATE`, backfill che sovrascrivono) senza richiesta
  esplicita e conferma.
- **Le migrazioni già committate non si modificano mai.** Si aggiunge una revisione nuova.
  Il file `0022_merge_reporting_and_absence_heads.py` esiste perché due rami hanno già
  generato head paralleli: dopo ogni `alembic revision` verifica `alembic heads`.
- `ensure_alembic_baseline()` e la catena di `init_db()` in [backend/app/db.py](backend/app/db.py)
  hanno un ordine che conta (create_all → schema updates → baseline → seed → propagazione
  org). Non riordinare, non "semplificare".

### 1.3 Modello di autorizzazione
- `build_auth_user_read()` in [backend/app/services/portal_auth.py](backend/app/services/portal_auth.py)
  è la **fonte unica** di `effective_role` e di tutti i `can_access_*`. La logica dei
  permessi vive lì, non sparsa negli endpoint.
- I `require_*` in [backend/app/api/deps.py](backend/app/api/deps.py) sono l'**unico**
  meccanismo di gate. Non scrivere controlli di ruolo a mano dentro un endpoint.
- In [backend/app/api/\_\_init\_\_.py](backend/app/api/__init__.py) esistono due router:
  `protected_router` (richiede `get_current_user`) e `api_router` (aperto).
  **Registrare una route su `api_router` la rende non autenticata.** Ogni eccezione lì
  dentro ha un commento che la giustifica: se ne aggiungi una, aggiungi il commento.
- L'utente "portale" (`settings.app_username`) è un caso speciale con permessi ristretti
  alle sole rendicontazioni. Non trattarlo come admin.

### 1.4 Contratti esterni
Questi endpoint hanno **client fuori dal repo** (app mobile rendicontazione, tablet
consegne, integrazioni). Cambiarli in modo incompatibile rompe sistemi che non vedi:
- `/api/auth/local-user/*`, `/api/daily-records`, `/api/activity-records/active*`,
  `/api/absence-requests` — documentati in [README.md](README.md)
- header `X-Tablet-Key` (flusso Consegne), `X-Impersonate-Employee` (admin)
- token di approvazione via email (`create_email_approval_token`)

### 1.5 Sistemi esterni in sola lettura
T-Hub **legge** da TMS/SGAM, stocktonoli, Gesap, NinjaOne, LDAP. **Non scrive mai** su
questi sistemi. Non proporre "sincronizzazioni bidirezionali".

### 1.6 Confini di modulo
- La rendicontazione operativa scrive **solo** nelle tabelle `operational_report_*` e
  nell'audit — mai su Planner, Jupiter, Timesheet, presenze o timer
  (vedi [docs/RENDICONTAZIONE_OPERATIVA.md](docs/RENDICONTAZIONE_OPERATIVA.md)).
- [backend/app/services/crypto.py](backend/app/services/crypto.py) è **l'unico** punto in
  cui i segreti delle integrazioni vengono cifrati/decifrati.

---

## 2. 📝 PROPOSAL — prima si propone, poi si implementa

Per questi interventi: **fermati, scrivi la proposta, aspetta l'ok.** Non iniziare a
scrivere codice "intanto".

- Modifiche di schema: nuove tabelle, colonne, indici, vincoli, rename
- Nuove dipendenze in `requirements.txt` o `package.json`
- Cambi di semantica di ruoli o permessi (chi vede cosa)
- Modifiche non retrocompatibili agli endpoint di §1.4
- Nuove variabili `.env` o una nuova integrazione esterna
- Refactor dei file grandi: `CalendarPage.jsx` (3.3k righe), `PlannerPage.jsx` (3.2k),
  `schemas.py` (2.1k), `services/timesheets.py` (1.8k), `services/operational_reporting.py` (1.3k)
- Qualsiasi cosa tocchi JWT, login, rate limiting, cifratura
- Script one-off o backfill sul database
- Rimozione o rinomina di route, file, colonne
- Cambio della configurazione nginx o dei compose file

**Formato della proposta** (breve, in italiano, 10–20 righe):

```
COSA      una frase: l'intervento
PERCHÉ    il problema concreto che risolve (con file:riga se è un bug)
IMPATTO   file toccati, endpoint/UI coinvolti, chi se ne accorge
RISCHI    cosa può rompersi, e per lo schema: migrazione additiva o distruttiva
ROLLBACK  come si torna indietro
TEST      quali test coprono la modifica, quali vanno aggiunti
```

Se la modifica è additiva, piccola e già coperta dai test esistenti (es. un fix di bug
dentro una funzione, una label sbagliata, un `require_*` mancante su un endpoint che
chiaramente ne aveva bisogno) → **non serve proposta**, procedi e spiega nel riepilogo.

---

## 3. ✅ ACCETTATO — pattern da riusare, e perché

Questi pattern sono già nel codice. **Riusali invece di inventarne di nuovi:** la coerenza
qui vale più dell'eleganza del singolo file.

| Pattern | Perché |
|---|---|
| Un router per dominio in `api/`, logica in `services/` | L'endpoint fa auth + validazione + serializzazione; il dominio è testabile senza HTTP |
| `raise DomainError("messaggio")` per gli errori di dominio | È mappato su HTTP 400 dall'handler in `main.py`; un `RuntimeError` diventerebbe un 500 e un alert inutile |
| `Depends(require_xxx)` per l'autorizzazione | Il permesso è visibile nella firma dell'endpoint, non sepolto nel body. Un gate che non si vede è un gate che si dimentica |
| `record_audit_log(db, action=…, entity=…, detail=…, actor_name=…)` su ogni mutazione sensibile | L'audit è consultabile dalla UI e serve a ricostruire chi ha fatto cosa su dati HR |
| `hmac.compare_digest()` per confrontare segreti | Confronto a tempo costante: `==` su una API key perde informazione |
| PK `String(36)` con `default=lambda: str(uuid4())` + `TimestampMixin` | Convenzione uniforme su tutti i modelli; gli ID non sono indovinabili e viaggiano bene nelle URL |
| SQLAlchemy 2.0: `Mapped[...]`, `mapped_column`, `select()`, `db.scalar(...)` | Il repo è tutto in 2.0; lo stile Query legacy 1.x è residuale e non va esteso |
| Query bulk / `selectinload` invece di N+1 | Lezione già pagata: l'endpoint scadenze apriva una connessione MSSQL *per dipendente* (vedi [docs/REPORT_OTTIMIZZAZIONI.md](docs/REPORT_OTTIMIZZAZIONI.md) §1.1) |
| Parametri SQL **bindati** (`%s` per pytds), escaping esplicito dove non è possibile | `config.py` documenta ogni query esterna: nessun input utente finisce concatenato in una stringa SQL |
| `services/timeutils.today_local()` (Europe/Rome) | Il container gira in UTC: `date.today()` sbaglia la giornata lavorativa in serata |
| Migrazioni **additive**, `IF NOT EXISTS` sugli indici | Il deploy non può permettersi una migration che fallisce a metà su dati reali |
| Frontend: tutto passa da `api.js` | Un solo punto gestisce Bearer token, `X-Impersonate-Employee`, il 401→logout e i download con `Content-Disposition` |
| Route `lazy()` + `ErrorBoundary` + TanStack Query | Le pagine pesanti (pdf-lib, @xyflow/react) non entrano nel bundle iniziale; una pagina che crasha non porta giù l'app |
| Gating UI con `requires:` in `SIDEBAR_SECTIONS` ([App.jsx](frontend/src/App.jsx)) | Il menu riflette i permessi calcolati dal backend, non una lista hardcoded di ruoli |
| Commenti in italiano che spiegano **il perché**, non il cosa | È lo stile del repo e ha valore reale: vedi i commenti su `liste_aperte_query` in `config.py` o su `rate_limit.py` |
| Test pytest con SQLite in-memory + fixture di `conftest.py` (`make_admin_token`, `make_linked_user_token`, `auth_headers`) | Girano in 36s senza toccare Postgres né i sistemi esterni |
| Logica pura del frontend estratta e testata con `node:test` (vedi `calendarOverlap.js`) | Nessun test runner nel frontend: questo è il modo che funziona qui, senza aggiungere Vitest |
| Testata, filtri e tabelle dai componenti di `frontend/src/components/` (`PageHeader`, `FilterBar`, `FilterSelect`, `tableStyles`) | Le 7 regole di layout valgono per tutte le pagine: implementarle a mano una pagina alla volta è come sono nate le divergenze attuali. Vedi [docs/LAYOUT_PAGINE.md](docs/LAYOUT_PAGINE.md) |

---

## 4. ❌ RIFIUTATO — cosa non fare, e perché

| Anti-pattern | Perché è rifiutato |
|---|---|
| Aggiungere una colonna e affidarsi a `create_all()` | `create_all` **non** altera tabelle esistenti: in sviluppo sembra funzionare, in produzione l'app parte e va in errore alla prima query. Sempre Alembic |
| Modificare una migrazione già committata | I DB che l'hanno già applicata non la rieseguono: schema divergente e silenzioso |
| `fetch()` diretto dentro una pagina React | Bypassa token, impersonation e gestione 401 di `api.js`: l'utente resta su una pagina morta invece di essere sloggato |
| Controllo di ruolo scritto a mano nell'endpoint | Duplica `build_auth_user_read` e diverge appena i permessi cambiano. È così che nascono gli IDOR |
| Nuova route su `api_router` invece di `protected_router` | La pubblichi senza autenticazione. È già successo (vedi §1.3 dei report in `docs/`) |
| `datetime.now()` naive, `date.today()` | Fuso del container ≠ fuso aziendale: giornate sbagliate su turni serali. Usa `timeutils` |
| Nuovo segreto di integrazione nel `.env` | Le credenziali delle integrazioni vivono **cifrate a DB** e si amministrano da Configurazione › Integrazioni. Il `.env` è per la configurazione d'ambiente, non per i segreti di terze parti |
| SQL costruita con f-string su input utente | SQL injection su database aziendali con dati reali |
| `print()` per il logging | Usa `logging`; `print` sparisce nei log strutturati e non ha livelli |
| Test che toccano Postgres reale, LDAP, MSSQL o SMTP | La suite deve girare in CI senza rete e senza credenziali. `conftest.py` è costruito apposta per questo |
| Refactor non richiesti, riordino import, riformattazioni "di passaggio" | Su file da 3000 righe producono diff illeggibili e nascondono la modifica vera. Tocca solo ciò che serve |
| Introdurre TypeScript, un nuovo state manager, un nuovo UI kit | Il frontend è JSX + MUI + React Query e deve restare uno solo di ciascuno |
| Aggiungere librerie che duplicano quelle presenti (date, PDF, grafici, HTTP) | Ci sono già `dayjs`, `pdf-lib`, `@xyflow/react`, `fetch`. Ogni dipendenza è superficie di manutenzione |
| `git add -A`, commit o push non richiesti | Il working tree ha ~140 file non committati su un solo commit iniziale: un `add -A` impacchetta lavoro altrui e rischia di includere file non destinati al repo |
| Committare `.env`, dump SQL, binari grandi | Il repo ha già un `export-consegne-data.sql` da 8.7 MB: non aggravare |
| Testi UI o `detail` di errore in inglese | L'interfaccia è italiana e la usano persone che leggono quei messaggi |
| Rimuovere il guard segreti, allargare CORS, disattivare il rate limit "per comodità di test" | Sono le uniche difese in atto e il deploy è raggiungibile in rete aziendale |

---

## 5. 🔬 Convalida — eseguita dall'utente

Gli agenti **non eseguono automaticamente test, lint, build, smoke test, migrazioni o
riavvii**. La convalida viene avviata dall'utente quando lo richiede esplicitamente.

Nel riepilogo finale l'agente deve dichiarare chiaramente che i controlli non sono stati
eseguiti e indicare quali sarebbero opportuni in base ai file modificati. I test possono
essere aggiunti o aggiornati quando fanno parte dell'intervento, ma non vanno lanciati
senza un comando dell'utente.

Le migrazioni Alembic devono comunque essere additive, rilette nel diff e collegate
all'head corrente; l'applicazione al database resta sempre a comando dell'utente.

---

## 6. Best practice di lavoro

**Prima di modificare**
1. Leggi il file **intero**, non solo la funzione. Questi file sono lunghi e pieni di
   contesto storico nei commenti.
2. `grep` per il pattern equivalente altrove nel repo: quasi sempre esiste già.
3. Guarda se un test copre l'area (`backend/tests/test_*.py`) e leggilo: descrive il
   comportamento atteso meglio del codice.
4. Controlla `docs/`: `REPORT_MIGLIORAMENTI.md` e `REPORT_OTTIMIZZAZIONI.md` elencano
   interventi **già applicati** e altri **consapevolmente non applicati** — non riproporre
   i secondi come scoperte nuove.

**Mentre modifichi**
5. Diff minimo. Una modifica = un problema.
6. Scrivi come scrive il repo: nomi in inglese, commenti in italiano, e un commento solo
   dove serve spiegare *perché*.
7. Se scopri un secondo problema mentre lavori: **segnalalo, non risolverlo di slancio**.
   Fai la modifica richiesta e chiudi il riepilogo con "ho anche notato X".
8. Non toccare `.env`. Se serve una variabile nuova, aggiornala in `.env.example` e dillo.

**Dopo aver modificato**
9. Non eseguire la convalida salvo richiesta esplicita dell'utente, come indicato in §5.
10. Riepilogo in italiano: cosa hai cambiato, quali file, controlli non eseguiti e cosa
    hai volutamente lasciato fuori.
11. **Non committare e non pushare** se non te lo chiedono. Se te lo chiedono, controlla
    `git status` prima: il working tree contiene molto lavoro non tuo.

**Comunicazione**
12. Se qualcosa non torna, chiedi. Una domanda costa meno di una migrazione sbagliata su
    dati HR reali.
13. Non inventare nomi di file, endpoint o colonne: verifica con `grep` prima di citarli.
14. Se una richiesta ricade in §1 (Congelato), dillo subito e proponi l'alternativa —
    poi, se l'utente conferma, procedi.

---

## 7. 🔌 Codice scollegato (unwired) — inventario da tenere aggiornato

Elementi **definiti ma non collegati a nulla**: esistono nel codice, compilano, passano i
test, ma nessuno li chiama. Non sono bug — spesso sono lavori lasciati a metà o resti di
funzionalità rimosse — ma sono debito: confondono chi legge, gonfiano il bundle e fanno
credere che una funzione esista quando dall'app è irraggiungibile.

**Regole per gli agenti:**
- **Non cancellare nulla di questo elenco di iniziativa.** Cancellare è una modifica da §2
  (Proposal): quello che sembra morto può essere il pezzo backend di una UI in arrivo.
- **Se colleghi o rimuovi una voce, togli la riga da questa tabella** nello stesso commit.
- **Se scopri un nuovo elemento scollegato, aggiungilo qui** invece di risolverlo di slancio.
- Prima di dichiarare morto qualcosa, cerca anche fuori dal repo: gli endpoint di §1.4
  hanno client esterni che non vedi (app mobile, tablet consegne).

*Rilevato il 2026-08-18 sul working tree corrente. Un elemento assente da questa tabella
non è garantito collegato: l'analisi è statica e non copre riferimenti dinamici.*

### 7.1 Funzionalità complete lato backend, mai richiamate dalla UI

Il caso più interessante: la catena API → client HTTP esiste, manca solo il punto di
innesco nell'interfaccia. Sono candidati al completamento, non alla cancellazione.

| Cosa | Backend | Client frontend | Stato |
|---|---|---|---|
| **Progetti locali** (CRUD completo) | `GET/POST/PUT/DELETE` in [backend/app/api/projects.py](backend/app/api/projects.py) (righe 15, 37, 59, 103) | `getLocalProjects`, `createLocalProject`, `updateLocalProject`, `deleteLocalProject` in [frontend/src/api.js](frontend/src/api.js#L425) | Nessuna pagina li invoca. `ProjectsPage.jsx` gestisce le commesse Jupiter, non i progetti locali |
| **Reso dispositivo** | `POST /{delivery_id}/return` → `mark_device_delivery_returned` ([device_deliveries.py:506](backend/app/api/device_deliveries.py#L506)) | `markDeviceDeliveryReturned` ([api.js:381](frontend/src/api.js#L381)) | Nessun pulsante nella UI. Lo schema `DeviceDeliveryReturn` è anch'esso orfano. Da non confondere con `/redeliver` (riga 268), che **è** collegato |
| **Modifica saldo assenze** | endpoint in [backend/app/api/absence_balances.py](backend/app/api/absence_balances.py) | `updateAbsenceBalance` ([api.js:654](frontend/src/api.js#L654)) | Il permesso `absence_can_edit_balances` esiste sul modello `Employee`, ma nessuna schermata scrive il saldo |

### 7.2 Backend — simboli mai referenziati

| Elemento | File | Nota |
|---|---|---|
| `office365_enabled(db)` | [services/integrations.py:97](backend/app/services/integrations.py#L97) | ✅ *Verificato il 2026-08-18: nessun problema di sicurezza.* L'interruttore **è** applicato, ma dalla proprietà `Office365Config.oof_active` (`enabled and oof_enabled and credentials_complete`), controllata da `sync_employee_oof` prima di aprire qualunque thread. Questo helper è quindi solo ridondante |
| `generate_local_user_password(length)` | [services/local_user_auth.py:18](backend/app/services/local_user_auth.py#L18) | `hash_local_user_password` accanto è usata; la generazione password evidentemente avviene altrove |
| `list_sync_runs_payload(db, limit)` | [services/timesheets.py:1247](backend/app/services/timesheets.py#L1247) | Nessun endpoint espone lo storico delle sincronizzazioni timesheet |
| `require_manager_or_above` | [api/deps.py](backend/app/api/deps.py) | Unico `require_*` mai applicato a un endpoint |
| Modello `Site` (tabella `sites`) | [models.py:266](backend/app/models.py#L266) | Tabella creata da `create_all` a ogni avvio, mai letta né scritta. I siti viaggiano come stringa in `Employee.default_site` |
| Enum `PlannerScope` | [enums.py](backend/app/enums.py) | Gli scope planner circolano come stringhe (`"self"`, `"team"`, `"all"`) via `planner_level_scope()`, che non usa questo enum |
| Schemi Pydantic orfani | [schemas.py](backend/app/schemas.py) | `InfinityMapFieldAssignmentUpdate`, `DeviceDeliveryReturn`, `LocalUserValidationResponse`, `TimesheetWorkerRead` — nessun endpoint li usa come request o response model |

### 7.3 Frontend — file e simboli scollegati

| Elemento | File | Nota |
|---|---|---|
| `getPortalRoleDisplayLabel(appRole, hasDirectReports)` | [pages/EmployeesPage.jsx](frontend/src/pages/EmployeesPage.jsx) | Etichetta corta del ruolo portale (`Mgr`, `Collab`). Rimasta senza chiamanti quando la colonna *Ruolo portale* è passata a sola icona con tooltip: il tooltip usa l'etichetta estesa di `portalRoleMeta` |
| `theme.js` (35 righe) | [frontend/src/theme.js](frontend/src/theme.js) | `createTheme` MUI **mai importato**: il tema vivo è quello di [ThemeContext.jsx](frontend/src/ThemeContext.jsx). File residuo, rimuovibile con più sicurezza degli altri — ma sempre da §2 |
| Le 6 funzioni di `api.js` di §7.1 | [frontend/src/api.js](frontend/src/api.js) | Unici export del client HTTP senza consumatori |

*Nessun CSS orfano, nessuna pagina fuori dal routing di `App.jsx`, nessun router backend
non registrato in `api/__init__.py`: quelle tre categorie sono pulite.*

### 7.4 Standalone per progetto — non sono errori

Non collegati all'app **di proposito**. Lasciali dove sono.

| Elemento | Natura |
|---|---|
| [backend/insert_ferie.py](backend/insert_ferie.py), [backend/import_ninjaone_deliveries.py](backend/import_ninjaone_deliveries.py), [backend/scripts/import_consegne_dump.py](backend/scripts/import_consegne_dump.py) | Script one-off, si eseguono a mano. Rientrano nella regola §2 sui backfill: non lanciarli mai spontaneamente |
| [frontend/src/pages/calendarOverlap.test.js](frontend/src/pages/calendarOverlap.test.js) | Test, eseguito da `node --test src/` |
| `export-consegne-data.sql` (8,4 MB, in due copie: root e `backend/`) | Dump di dati, aggiunto a `.gitignore`. La copia duplicata è probabilmente da eliminare dal filesystem — chiedi prima |
| [EXPORT-CONSEGNE.md](EXPORT-CONSEGNE.md) | Documentazione dell'export, non referenziata dal codice |

### Come rigenerare questo inventario

```bash
# Export di api.js senza consumatori
cd frontend/src && grep -oP '^export (async )?function \K\w+' api.js | while read fn; do
  [ "$(grep -rn "\b$fn\b" . --include='*.jsx' --include='*.js' | grep -vc '^api.js:')" -eq 0 ] && echo "$fn"
done

# Funzioni di services/ mai referenziate (app + tests + script)
cd backend && for f in app/services/*.py; do
  grep -oP '^(async )?def \K\w+' "$f" | grep -v '^_' | while read fn; do
    [ "$(grep -rn "\b$fn\b" app tests --include='*.py' | grep -v "def $fn" | wc -l)" -eq 0 ] && echo "$f :: $fn"
  done
done

# Router non registrati
cd backend/app/api && for f in *.py; do case $f in __init__.py|deps.py) continue;; esac
  grep -q "app.api.${f%.py} import" __init__.py || echo "non registrato: $f"; done
```

---

## 8. 🔒 Come queste regole vengono applicate

Un documento di regole che nessuno è obbligato a leggere è un documento che verrà
ignorato. Qui l'obbligo è a tre livelli, di forza crescente. Solo il terzo è vera
imposizione: gli altri due sono contesto.

### 8.1 Livello 1 — convenzione (tutti gli agenti)

I file pointer ([CLAUDE.md](CLAUDE.md), [.github/copilot-instructions.md](.github/copilot-instructions.md),
[.cursorrules](.cursorrules)) fanno sì che ogni strumento trovi le regole nel posto in cui
le cerca. È una convenzione: l'agente **può** ignorarla.

### 8.2 Livello 2 — contesto garantito (Claude Code)

[CLAUDE.md](CLAUDE.md) apre con `@AGENTS.md`. Claude Code carica CLAUDE.md a ogni sessione
e risolve l'import, quindi **il contenuto di questo file è in contesto dal primo turno**,
non solo citato. Costa zero e non richiede che l'agente decida di leggerlo.

### 8.3 Livello 3 — gate bloccante (Claude Code)

Configurato in [.claude/settings.json](.claude/settings.json), con gli script in
[scripts/hooks/](scripts/hooks/):

| Hook | Evento | Effetto |
|---|---|---|
| [agents-md-gate.sh](scripts/hooks/agents-md-gate.sh) | `PreToolUse` su `Edit\|Write\|NotebookEdit\|Bash` | **Nega** l'operazione finché la versione corrente di AGENTS.md non è stata letta in questa sessione |
| [agents-md-mark.sh](scripts/hooks/agents-md-mark.sh) | `PostToolUse` su `Read\|Bash` | Registra la lettura salvando l'impronta SHA-256 del file in `$TMPDIR/claude-agents-md/<session_id>` |
| [agents-md-lib.sh](scripts/hooks/agents-md-lib.sh) | — | Funzioni condivise: impronta e riconoscimento dei comandi di sola lettura |

Non è un promemoria che il modello può ignorare: è l'harness che rifiuta lo strumento e
restituisce all'agente il motivo. Il blocco scatta **una sola volta per sessione** — dopo
la lettura si lavora senza attrito.

**Su Bash vale il deny-by-default.** Il gate non cerca i pattern di scrittura per poi
consentire tutto il resto: consente solo ciò che è riconoscibilmente di sola lettura
(`ls`, `cat`, `grep`, `find`, `sed -n`, i sottocomandi git che non modificano nulla…) e
nega il resto, interpreti compresi. La regola inversa era aggirabile da un
`python3 - <<PY` che apre un file in scrittura: il testo del comando non lo rivela.
Poiché il blocco vale una volta per sessione, un falso positivo costa una lettura, mentre
un falso negativo costava l'intera protezione.

I comandi composti sono valutati **per segmento** (`;`, `&&`, `||`, `|`): `ls && python3 x.py`
viene negato per via del secondo. Le redirezioni di silenziamento (`2>/dev/null`, `2>&1`)
non contano come scrittura, altrimenti quasi ogni comando di lettura verrebbe bloccato.

**Il marcatore è legato all'impronta di AGENTS.md.** Se il file cambia, le letture
precedenti non valgono più e il gate rimanda a rileggerlo con un messaggio diverso. Serve
a chi sta lavorando da ore su regole nel frattempo modificate — incluso il caso in cui a
modificarle sia stato un altro agente in parallelo.

La marcatura è volutamente stretta: valgono solo lo strumento `Read` su un file chiamato
AGENTS.md, oppure un comando shell il cui primo token è un lettore noto (`cat`, `head`,
`sed`, `less`…) con AGENTS.md tra gli argomenti. Una versione più permissiva si
accontenterebbe di un `grep AGENTS.md`, o di uno script che la cita in un commento, e il
gate diventerebbe una formalità. I marcatori più vecchi di 7 giorni vengono ripuliti da soli.

### 8.4 Limiti, dichiarati

Non fingere che il gate sia una barriera invalicabile:

- **Vale solo per Claude Code.** Codex, Cursor e Copilot leggono i file di §8.1 ma non
  eseguono questi hook. Per loro l'obbligo resta una convenzione. L'unico livello davvero
  trasversale sarebbe un hook git `pre-commit`: **non è stato implementato**.
- **Impone di leggere le regole, non di rispettarle.** Nulla verifica che le §1–§4 vengano
  seguite. Le voci più nette di §1 (`.env`, migrazioni già committate) sarebbero
  verificabili da una macchina, ma oggi non lo sono.
- **Fallisce aperto per scelta.** Se AGENTS.md non esiste o manca `jq`, il gate consente:
  un checkout senza il file non deve diventare inutilizzabile.
- **Lo stato è per sessione**, in `$TMPDIR`. Una nuova sessione riparte bloccata.
- **L'allowlist di sola lettura va tenuta viva.** Un comando di esplorazione legittimo ma
  non elencato viene negato finché non si legge AGENTS.md: fastidio minimo, ma se ricorre
  spesso conviene aggiungere il token in `_TOKEN_LETTURA` dentro `agents-md-lib.sh`.

### 8.5 Manutenzione

- Disattivare temporaneamente: `/hooks` nella UI, oppure rimuovere il blocco da
  [.claude/settings.json](.claude/settings.json).
- Renderlo non bloccante (solo promemoria): in `agents-md-gate.sh` sostituire
  `permissionDecision: "deny"` con `"ask"`, oppure emettere
  `hookSpecificOutput.additionalContext` senza decisione.
- Dopo aver modificato `.claude/settings.json` serve aprire `/hooks` una volta o riavviare
  la sessione, perché il watcher rilegga la configurazione.


---

## 9. Documentazione da aggiornare

| Se cambi… | Aggiorna… |
|---|---|
| un endpoint pubblico / contratto esterno | [README.md](README.md) |
| una variabile di configurazione | `.env.example` (mai `.env`) |
| un confine o una regola di un modulo | il documento in [docs/](docs/) del modulo |
| colleghi, rimuovi o scopri codice scollegato | l'inventario in **§7** di questo file |
| il meccanismo di enforcement (hook, settings) | **§8** di questo file |
| queste regole | **questo file** (`AGENTS.md`), non i pointer |

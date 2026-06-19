# Workforce Planner

Scaffold iniziale per il planner del personale operativo descritto nel PDR:

- backend `FastAPI`
- frontend `React + Vite + Material UI`
- database applicativo `PostgreSQL`
- deploy locale `Docker Compose`
- sincronizzazione anagrafica dal TMS `SQL Server`

## Stato attuale

Questo primo setup copre:

- modello dati base per `Employee`, `Assignment`, `Site`, `User`, `AuditLog`
- autenticazione `LDAP` con token `JWT`
- sincronizzazione manuale anagrafica dal TMS
- disattivazione sicura dei dipendenti non piu presenti nel feed TMS
- planner base con creazione assegnazioni giornaliere
- dashboard con conteggi giornalieri
- frontend minimo per consultazione, sync e pianificazione

## Configurazione

1. Copiare `.env.example` in `.env`
2. Inserire le credenziali reali del TMS in:

- `TMS_USERNAME`
- `TMS_PASSWORD`

3. Inserire i parametri LDAP e JWT in:

- `LDAP_URI`
- `LDAP_DOMAIN`
- `LDAP_USER_DN` se vuoi forzare la base utenti
- `LDAP_GROUP_DN` se vuoi forzare la base gruppi
- `LDAP_ALLOWED_GROUP` se vuoi limitare l'accesso a un gruppo AD specifico
- `JWT_SECRET_KEY`

Il sistema usa di default:

- host TMS: `192.168.23.52`
- database TMS: `SGAM`
- property code dipendenti: `02`

La query caricata nel backend riprende quella fornita e usa il database gia selezionato in connessione, quindi non serve il prefisso `USE SGAM`.
Per la tab scadenze dipendente puoi opzionalmente sovrascrivere `TMS_EMPLOYEE_EXPIRATIONS_QUERY`; di default il backend legge `T2BaseDipendentiScadenze` joinata a `T2BaseTipiScadenza` filtrando per `'{employee_code}'`.

## Avvio

```bash
docker compose up -d --build
```

Dopo il primo avvio, frontend e backend restano in live-reload:

- backend: `uvicorn --reload`
- frontend: `vite` dev server con HMR
- le modifiche ai file sotto `backend/` e `frontend/` vengono recepite senza rilanciare `docker compose up --build`

Serve un nuovo `docker compose up --build` solo se cambi Dockerfile o dipendenze.

Punti di accesso:

- applicazione: `http://localhost:8088`
- API health: `http://localhost:8088/health`
- API docs: `http://localhost:8088/api/docs`

## API principali

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/employees`
- `POST /api/employees/sync`
- `GET /api/assignments?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `POST /api/assignments`
- `PUT /api/assignments/{assignment_id}`
- `GET /api/dashboard?date=YYYY-MM-DD`

## Note implementative

- L'anagrafica applicativa e in sola lettura lato UI.
- Le API applicative richiedono un bearer token ottenuto via login LDAP.
- Il login LDAP esegue bind diretto con `username@LDAP_DOMAIN`.
- Se `LDAP_ALLOWED_GROUP` e valorizzato, l'accesso viene consentito solo ai membri di quel gruppo.
- Al primo login LDAP viene creato automaticamente l'utente locale nel database con ruolo preso da `LDAP_DEFAULT_ROLE`.
- Il backend conserva il nome completo originale del TMS e prova anche a separare cognome/nome con una euristica prudente.
- Se il TMS restituisce zero righe e ci sono gia dipendenti sincronizzati, il sync fallisce per evitare disattivazioni massive dovute a errori di connessione o query.

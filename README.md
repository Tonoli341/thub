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

### Endpoint esterni (HMAC)

Endpoint riservati a client esterni autenticati tramite firma HMAC-SHA256.
Il segreto condiviso va impostato in `LOCAL_USER_API_KEY`.

Ogni richiesta deve includere due header:

| Header | Valore |
|--------|--------|
| `X-Timestamp` | Unix timestamp corrente (secondi) |
| `X-Signature` | `HMAC-SHA256(secret, "<timestamp>\n<body>")` in hex |

Il server rifiuta richieste con timestamp più vecchio di 5 minuti.

---

#### `POST /api/auth/local-user/validate`

Verifica username e password di un utente locale e restituisce i dati del dipendente con la squadra di appartenenza.

**Request body:**
```json
{
  "username": "153",
  "password": "d8H3Ja5AkaYQVTGr"
}
```

**Response `200`:**
```json
{
  "authenticated": true,
  "employee": {
    "id": "...",
    "tms_id": "153",
    "full_name": "ROSSI MARIO",
    "first_name": "MARIO",
    "last_name": "ROSSI",
    "phone": "...",
    "tms_role_code": "05",
    "tms_role_description": "PULIZIE",
    "contract_type": "...",
    "datore_lavoro": "...",
    "organization_function": "Operations",
    "organization_department": "Pulizie",
    "organization_role": null,
    "manager_name": "...",
    "birth_date": "1984-07-07",
    "is_active": true
  },
  "team": {
    "id": "...",
    "name": "Team Pulizie",
    "icon": "🎋",
    "color": "#6d3bf7",
    "team_leader_id": null,
    "team_leader_name": null,
    "members": [
      { "id": "...", "tms_id": "153", "full_name": "ROSSI MARIO" },
      { "id": "...", "tms_id": "115", "full_name": "BIANCHI ANNA" }
    ]
  }
}
```

`team` è `null` se il dipendente non appartiene a nessuna squadra.

| Status | Causa |
|--------|-------|
| `401` | Credenziali errate, utente inattivo, firma o timestamp non validi |
| `403` | Password scaduta |
| `503` | `LOCAL_USER_API_KEY` non configurata |

---

#### `GET /api/auth/local-user/employees`

Restituisce l'elenco di tutti i dipendenti attivi con matricola e nominativo, ordinati per nome.

Nessun body richiesto. Gli header HMAC (`X-Timestamp`, `X-Signature`) sono obbligatori.

**Response `200`:**
```json
[
  { "tms_id": "115", "full_name": "BIANCHI ANNA" },
  { "tms_id": "153", "full_name": "ROSSI MARIO" }
]
```

| Status | Causa |
|--------|-------|
| `401` | Firma o timestamp non validi |
| `503` | `LOCAL_USER_API_KEY` non configurata |

---

#### `GET /api/auth/local-user/me?date=YYYY-MM-DD`

Restituisce le info di base del dipendente autenticato: anagrafica, pianificazione del giorno richiesto e assenze in corso/future — l'equivalente esterno del box **"Le mie info"** mostrato nella home del portale THub. `date` è opzionale (default: oggi).

**Response `200`:**
```json
{
  "employee": {
    "id": "152c7e89-...",
    "tms_id": "153",
    "full_name": "ROSSI MARIO",
    "first_name": "MARIO",
    "last_name": "ROSSI",
    "phone": "33xxxxxxxx",
    "tms_role_code": "05",
    "tms_role_description": "PULIZIE",
    "contract_type": "...",
    "datore_lavoro": "SERVIZI TONOLI SCRL",
    "organization_function": "Operations",
    "organization_department": "Pulizie",
    "organization_role": null,
    "manager_name": "BIANCHI GIULIO",
    "birth_date": "1984-07-07",
    "is_active": true,
    "default_operational_area_id": "3d59fb8b-...",
    "default_operational_area_name": "Sede",
    "default_immobile": "F2"
  },
  "date": "2026-07-01",
  "today_assignments": [
    { "area": "Kimberly", "site": "Fossano", "immobile": "F2", "start_time": "08:00", "end_time": "17:00" }
  ],
  "upcoming_absences": [
    {
      "id": "9c1e4b7a-...",
      "justification_type": "FERIE",
      "start_date": "2026-07-10",
      "end_date": "2026-07-12",
      "approval_status": "approved",
      "start_time": null,
      "end_time": null
    }
  ],
  "pending_count": 0
}
```

| Status | Causa |
|--------|-------|
| `200` | Info restituite |
| `401` | Token mancante, non valido o scaduto |

---

#### `POST /api/daily-records`

Crea o aggiorna la giornata del dipendente autenticato, inclusi inizio, fine e pause. Se il client rimanda la stessa data per lo stesso dipendente, il record esistente viene aggiornato. Richiede Bearer token ottenuto da `POST /api/auth/local-user/login`.

**Request body:**
```json
{
  "employee_id": "152c7e89-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "date": "2026-06-30",
  "started_at": "2026-06-30T08:00:00+02:00",
  "ended_at": "2026-06-30T17:00:00+02:00",
  "pauses": [
    {
      "started_at": "2026-06-30T12:00:00+02:00",
      "ended_at": "2026-06-30T12:30:00+02:00"
    }
  ],
  "work_seconds": 30600,
  "pause_seconds": 1800
}
```

**Response `200`:**
```json
{
  "id": "e7f8a9b0-...",
  "date": "2026-06-30"
}
```

| Status | Causa |
|--------|-------|
| `200` | Giornata registrata o aggiornata |
| `401` | Token mancante, non valido o scaduto |
| `403` | `employee_id` diverso dal dipendente autenticato |
| `422` | Payload non valido |

---

#### `GET /api/daily-records/me?date=YYYY-MM-DD`

Restituisce la giornata già registrata per il dipendente autenticato e per la data richiesta. Serve al client esterno per caricare i valori correnti, permettere la modifica e poi reinviarli a `POST /api/daily-records`.

**Response `200`:**
```json
{
  "id": "e7f8a9b0-...",
  "employee_id": "152c7e89-...",
  "employee_name": "ROSSI MARIO",
  "operational_area_id": "3d59fb8b-...",
  "operational_area_name": "Kimberly",
  "building": "F2",
  "date": "2026-06-30",
  "started_at": "2026-06-30T08:00:00+02:00",
  "ended_at": "2026-06-30T17:00:00+02:00",
  "pauses": [
    {
      "started_at": "2026-06-30T12:00:00+02:00",
      "ended_at": "2026-06-30T12:30:00+02:00"
    }
  ],
  "work_seconds": 30600,
  "pause_seconds": 1800,
  "created_at": "2026-06-30T17:05:00Z"
}
```

| Status | Causa |
|--------|-------|
| `200` | Giornata trovata |
| `401` | Token mancante, non valido o scaduto |
| `404` | Nessuna giornata registrata per la data richiesta |

---

### Richiesta ferie (`/api/absence-requests`)

Vista semplificata dello stesso sistema di assenze usato dal portale (box "Assenze"): il dipendente può richiedere, modificare e cancellare **solo le proprie** ferie. Il tipo è sempre `FERIE` (come nella UI semplificata "Assenza" del portale, dove la distinzione è solo tra **Giorno** — orario custom, `start_date == end_date` — e **Giorni** — intervallo di giorni interi, `start_time=08:00`/`end_time=18:00`; il vecchio `end_time=17:00` resta letto come giornata intera per le richieste già inviate: questa scelta va fatta lato client esattamente come nel portale). Tutti richiedono il Bearer token del login locale.

Se il dipendente ha `absence_requires_approval` attivo, la richiesta nasce `pending` e notifica gli approvatori configurati (stesso flusso del portale); altrimenti nasce già `approved`. **Una volta `approved` o `rejected`, la richiesta non può più essere modificata né cancellata** (stessa regola già applicata nel portale interno).

| Metodo | Path | Scopo |
|--------|------|-------|
| `POST` | `/api/absence-requests` | Crea una richiesta ferie per il dipendente autenticato. |
| `GET` | `/api/absence-requests?start=YYYY-MM-DD&end=YYYY-MM-DD` | Elenco delle proprie richieste (filtri di data opzionali). |
| `PUT` | `/api/absence-requests/{id}` | Modifica una propria richiesta ancora `pending`. `409` se già approvata/rifiutata. |
| `DELETE` | `/api/absence-requests/{id}` | Cancella una propria richiesta ancora `pending`. `409` se già approvata/rifiutata. |

**Richiesta:**
```json
POST /api/absence-requests
{
  "description": "Ferie estive",
  "start_date": "2026-08-10",
  "end_date": "2026-08-14",
  "start_time": "08:00",
  "end_time": "18:00"
}
```

**Risposta `201`:**
```json
{
  "id": "a1b2c3d4-...",
  "employee_id": "152c7e89-...",
  "justification_type": "FERIE",
  "description": "Ferie estive",
  "start_date": "2026-08-10",
  "end_date": "2026-08-14",
  "start_time": "08:00:00",
  "end_time": "18:00:00",
  "approval_status": "pending",
  "approval_required": true,
  "approver_1_employee_name": "BIANCHI GIULIO",
  "approver_2_employee_name": null,
  "approver_3_employee_name": null,
  "created_at": "2026-07-01T09:00:00Z",
  "updated_at": "2026-07-01T09:00:00Z"
}
```

| Status | Causa |
|--------|-------|
| `201` | Richiesta creata |
| `200` | Elenco restituito / richiesta aggiornata |
| `204` | Richiesta cancellata |
| `401` | Token mancante, non valido o scaduto |
| `404` | Richiesta non trovata (o non appartenente al dipendente autenticato) |
| `409` | Sovrapposizione con un'altra assenza esistente, oppure richiesta già approvata/rifiutata |
| `422` | Payload non valido (es. `end_date` precedente a `start_date`) |

---

### Timer attività realtime (`/api/activity-records/active`)

Endpoint pensati per un client mobile che deve mostrare un timer continuo anche dopo chiusura dell'app, riavvio del telefono o perdita temporanea di connessione. Il backend è il punto di verità: mantiene al massimo **un'attività "active" per dipendente** (`started_at`, pause accumulate, campi del form in bozza). Alla chiusura, l'attività viene convertita in un `ActivityRecord` definitivo con lo stesso schema già prodotto da `POST /api/activity-records` — il flusso storico/offline-flush esistente non cambia.

Tutti richiedono il Bearer token del login locale (`POST /api/auth/local-user/login`).

| Metodo | Path | Scopo |
|--------|------|-------|
| `POST` | `/api/activity-records/active` | Avvia il timer. `409` se ce n'è già uno in corso (recuperabile con `GET`). Idempotente se si ripete lo stesso `client_token`. |
| `GET` | `/api/activity-records/active` | Recupera l'attività in corso (per ricostruire il timer alla riapertura dell'app). `404` se non ce n'è una. Aggiorna `last_heartbeat_at`. |
| `PATCH` | `/api/activity-records/active` | Aggiorna i campi in bozza (`operational_area_id`, `building`, `field_values`) e funge da heartbeat periodico. |
| `POST` | `/api/activity-records/active/pause` | Mette in pausa il timer (idempotente se già in pausa). |
| `POST` | `/api/activity-records/active/resume` | Riprende il timer, accumulando il tempo di pausa in `pause_seconds`. |
| `POST` | `/api/activity-records/active/close` | Chiude il timer e crea l'`ActivityRecord` finale (`duration_seconds` calcolato al netto delle pause). Risposta identica a `POST /api/activity-records`. |
| `DELETE` | `/api/activity-records/active` | Abbandona l'attività in corso senza creare alcun record storico. |
| `GET` | `/api/activity-records/active/admin` | (JWT portale) Elenco dei timer attualmente aperti su tutti i dipendenti, con nomi risolti ed `elapsed_seconds` calcolato, utile per individuare sessioni abbandonate tramite `last_heartbeat_at`. |
| `POST` | `/api/activity-records/active/admin/{employee_id}/close` | (JWT portale) Chiusura forzata del timer di un dipendente: crea l'`ActivityRecord` finale come farebbe `POST .../active/close` lato dipendente. Usata dalla sezione "Timer attivi" del portale THub. |
| `DELETE` | `/api/activity-records/active/admin/{employee_id}` | (JWT portale) Scarto forzato del timer di un dipendente, senza creare alcun record storico. |

**Avvio:**
```json
POST /api/activity-records/active
{
  "mapping_id": "b3b6a930-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "field_values": {},
  "client_token": "6f2b7a10-9c1e-4b7a-9b1a-1c2d3e4f5a6b"
}
```

**Stato corrente (recupero automatico):**
```json
GET /api/activity-records/active
```
```json
{
  "id": "a1b2c3d4-...",
  "employee_id": "152c7e89-...",
  "mapping_id": "b3b6a930-...",
  "operational_area_id": "3d59fb8b-...",
  "building": "F2",
  "started_at": "2026-06-30T08:00:00Z",
  "paused_at": null,
  "pause_seconds": 0,
  "field_values": {},
  "client_token": "6f2b7a10-9c1e-4b7a-9b1a-1c2d3e4f5a6b",
  "last_heartbeat_at": "2026-06-30T08:12:00Z",
  "created_at": "2026-06-30T08:00:00Z"
}
```
Il client ricostruisce il tempo trascorso come `now - started_at - pause_seconds` (meno l'eventuale pausa in corso se `paused_at` è valorizzato).

**Chiusura:**
```json
POST /api/activity-records/active/close
{
  "field_values": { "numero_ddt": "DDT-2025-0042" }
}
```
restituisce l'`ActivityRecord` finale (stesso schema di `POST /api/activity-records`).

| Status | Causa |
|--------|-------|
| `201` | Timer avviato / attività chiusa e registrata |
| `200` | Stato letto o aggiornato |
| `204` | Attività abbandonata |
| `401` | Token mancante, non valido o scaduto |
| `404` | Nessuna attività in corso per il dipendente |
| `409` | Esiste già un'attività in corso (avvio) o record duplicato (chiusura) |
| `422` | Payload non valido o durata calcolata non valida |

---

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
- API health: `http://localhost:8088/health` (e `http://localhost:8088/api/health/ready`)
- documentazione degli endpoint esterni: sezione **Configurazione › Endpoint API**
  dell'applicazione (`/endpoints`, riservata agli amministratori)

Swagger e lo schema OpenAPI **non sono esposti da nginx**: FastAPI li serve su `/docs` e
`/openapi.json`, percorsi che il proxy instrada al frontend, e la porta 8000 del backend
non è pubblicata. Per consultarli serve entrare nel container:

```bash
docker compose exec backend curl -s localhost:8000/openapi.json
```

## API principali

- `POST /api/auth/login`
- `GET /api/auth/me`
- `GET /api/employees`
- `POST /api/employees/sync`
- `GET /api/assignments?start=YYYY-MM-DD&end=YYYY-MM-DD`
- `POST /api/assignments`
- `PUT /api/assignments/{assignment_id}`
- `GET /api/dashboard?date=YYYY-MM-DD`
- `GET /api/auth/local-user/me?date=YYYY-MM-DD` (info di base dipendente per client esterni)
- `POST /api/absence-requests` (richiesta ferie del dipendente)
- `POST /api/daily-records`
- `POST /api/activity-records/active` (avvio timer attività realtime)
- `GET /api/activity-records/active` (recupero attività in corso)
- `POST /api/activity-records/active/close` (chiusura timer → ActivityRecord)

## Note implementative

- L'anagrafica applicativa e in sola lettura lato UI.
- Le API applicative richiedono un bearer token ottenuto via login LDAP.
- Il login LDAP esegue bind diretto con `username@LDAP_DOMAIN`.
- Se `LDAP_ALLOWED_GROUP` e valorizzato, l'accesso viene consentito solo ai membri di quel gruppo.
- Al primo login LDAP viene creato automaticamente l'utente locale nel database con ruolo preso da `LDAP_DEFAULT_ROLE`.
- Il backend conserva il nome completo originale del TMS e prova anche a separare cognome/nome con una euristica prudente.
- Se il TMS restituisce zero righe e ci sono gia dipendenti sincronizzati, il sync fallisce per evitare disattivazioni massive dovute a errori di connessione o query.

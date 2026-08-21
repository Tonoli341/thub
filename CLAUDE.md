# CLAUDE.md

@AGENTS.md

Le regole operative di questo progetto sono in **[AGENTS.md](AGENTS.md)**, file unico e
canonico per tutti gli agenti AI. Leggilo integralmente prima di modificare il codice.

Promemoria dei punti che sbagliano più spesso gli agenti su T-Hub:

- **Dati reali in produzione.** Niente script distruttivi, niente backfill non richiesti.
- **`.env` non si legge e non si committa.** Le variabili si documentano in `.env.example`.
- **Schema solo via Alembic** (`create_all` non aggiunge colonne a tabelle esistenti).
- **Autorizzazione solo via `require_*` di `backend/app/api/deps.py`**, e route autenticate
  su `protected_router` — non su `api_router`.
- **Docker non è accessibile dalla shell**: usa `backend/.venv` per test e lint.
- **Convalida obbligatoria dopo ogni modifica** — vedi §5 di AGENTS.md:
  ```bash
  cd backend  && ./.venv/bin/python -m pytest -q && ./.venv/bin/ruff check app tests
  cd frontend && node --test src/ && npm run build
  ./scripts/smoke.sh          # tutte le sezioni rispondono (evita il Connection Refused)
  ```
- **Smoke obbligatorio** dopo ogni modifica a route, import, router o pagine: i test
  unitari montano l'app in memoria e non si accorgono che il servizio reale è caduto.
- **Non committare e non pushare** senza richiesta esplicita.
- **Codice scollegato**: l'inventario è in §7 di AGENTS.md — non cancellare nulla di
  iniziativa, e aggiorna la tabella se colleghi o rimuovi una voce.

# Istruzioni per GitHub Copilot

Le regole operative di questo progetto sono in **[AGENTS.md](../AGENTS.md)**, file unico e
canonico per tutti gli agenti AI. Vale integralmente anche qui.

Sintesi:

- T-Hub è **in produzione con dati reali**: modifiche minime, niente refactor non richiesti.
- Stack: FastAPI + SQLAlchemy 2.0 + PostgreSQL · React 18 + Vite + MUI + TanStack Query
  (**JSX, niente TypeScript**).
- Codice in inglese, **commenti e testi UI in italiano**.
- Autorizzazione: solo tramite `require_*` in `backend/app/api/deps.py`; i permessi si
  calcolano in `services/portal_auth.py`, mai inline negli endpoint.
- Errori di dominio: `raise DomainError(...)` (→ HTTP 400), mai `RuntimeError`.
- Schema: solo migrazioni Alembic additive; le migrazioni committate non si modificano.
- Date/orari: `services/timeutils.today_local()` (Europe/Rome), mai `date.today()`.
- Frontend: ogni chiamata HTTP passa da `src/api.js`.
- Convalida: `pytest -q` + `ruff check app tests` (backend), `node --test src/pages/` +
  `npm run build` (frontend), poi `./scripts/smoke.sh` per verificare che tutte le sezioni
  rispondano — e' il controllo che intercetta il Connection Refused da import rotto.
- Codice scollegato (unwired): inventario in §7 di AGENTS.md; non cancellarlo di iniziativa.

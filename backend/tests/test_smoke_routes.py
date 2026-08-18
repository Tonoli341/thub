"""Smoke test: ogni sezione dell'applicazione deve *rispondere*.

Serve a intercettare la classe di errori che si manifesta all'utente come
"Connection Refused" o come pagina bianca: un import rotto, un decoratore
sbagliato, un router non registrato, una dipendenza che esplode prima ancora di
arrivare al corpo dell'endpoint. Sono errori che i test funzionali non vedono,
perche' ognuno importa solo il pezzo che gli serve: qui invece si monta l'app
intera e si bussa a ogni porta.

Cosa NON verifica: che la risposta sia corretta. 401 e 403 sono esiti validi —
l'endpoint c'e', il gate funziona. Cio' che non e' tollerato e' il silenzio
(app che non si importa), il 404 su una route dichiarata e il 500.
"""

import pytest
from fastapi.routing import APIRoute

from app.main import app

# Valori fittizi per i path parameter: servono solo a rendere l'URL risolvibile.
# Un id inesistente e' perfetto — l'endpoint deve rispondere 401/403/404, non 500.
PATH_PARAM_SAMPLES = {
    "employee_id": "00000000-0000-0000-0000-000000000000",
    "activity_id": "00000000-0000-0000-0000-000000000000",
    "delivery_id": "00000000-0000-0000-0000-000000000000",
    "justification_id": "00000000-0000-0000-0000-000000000000",
    "assignment_id": "00000000-0000-0000-0000-000000000000",
    "team_id": "00000000-0000-0000-0000-000000000000",
    "project_id": "00000000-0000-0000-0000-000000000000",
}
DEFAULT_PATH_PARAM = "00000000-0000-0000-0000-000000000000"

# Esiti accettabili senza autenticazione: l'endpoint esiste e ha risposto.
# 401/403 = gate attivo. 404 = risorsa fittizia non trovata. 422 = parametro
# obbligatorio mancante. 503 = integrazione non configurata in ambiente di test.
RESPONDING_STATUSES = {200, 201, 204, 400, 401, 403, 404, 422, 503}


def _api_routes(methods: set[str]) -> list[APIRoute]:
    return [
        route
        for route in app.routes
        if isinstance(route, APIRoute) and methods & set(route.methods)
    ]


def _resolve(path: str) -> str:
    for name, value in PATH_PARAM_SAMPLES.items():
        path = path.replace("{" + name + "}", value)
    while "{" in path:
        start = path.index("{")
        end = path.index("}", start)
        path = path[:start] + DEFAULT_PATH_PARAM + path[end + 1 :]
    return path


def test_app_si_importa_e_monta_le_route():
    """Se questo test fallisce, in produzione uvicorn non parte: e' esattamente
    la causa di un Connection Refused sul browser."""
    routes = _api_routes({"GET", "POST", "PUT", "PATCH", "DELETE"})
    assert len(routes) > 150, f"solo {len(routes)} route montate: un router non e' stato registrato"


def test_ogni_router_e_registrato():
    """Ogni modulo in app/api/ deve comparire tra le route montate: un router
    dimenticato in api/__init__.py e' una sezione che risponde 404."""
    import pkgutil

    from fastapi import APIRouter

    import app.api as api_pkg

    montati = {route.path for route in _api_routes({"GET", "POST", "PUT", "PATCH", "DELETE"})}
    esclusi = {"__init__", "deps"}
    mancanti = []
    for module in pkgutil.iter_modules(api_pkg.__path__):
        if module.name in esclusi:
            continue
        modulo = __import__(f"app.api.{module.name}", fromlist=["*"])
        # isinstance e non hasattr: gli oggetti `func.*` di SQLAlchemy hanno un
        # __getattr__ permissivo che farebbe passare qualunque hasattr.
        routers = [attr for attr in vars(modulo).values() if isinstance(attr, APIRouter)]
        for router in routers:
            if not router.routes:
                continue
            atteso = [f"/api{route.path}" for route in router.routes if isinstance(route, APIRoute)]
            if atteso and not any(path in montati for path in atteso):
                mancanti.append(f"{module.name} ({atteso[0]})")
    assert not mancanti, "router non registrati in api/__init__.py: " + ", ".join(mancanti)


@pytest.mark.parametrize(
    "path",
    sorted({route.path for route in _api_routes({"GET"})}),
)
def test_ogni_sezione_get_risponde(client, path):
    """Bussa a ogni endpoint GET senza credenziali.

    Un 500 qui significa che l'endpoint esplode prima di validare i permessi:
    per l'utente e' una sezione morta.
    """
    response = client.get(_resolve(path))
    assert response.status_code in RESPONDING_STATUSES, (
        f"{path} ha risposto {response.status_code} — la sezione non risponde correttamente"
    )


@pytest.mark.parametrize(
    "path",
    sorted({route.path for route in _api_routes({"GET"}) if route.path.startswith("/api/")}),
)
def test_ogni_sezione_protetta_rifiuta_gli_anonimi(client, path):
    """Nessun endpoint sotto /api/ deve restituire dati a un anonimo.

    Unica esenzione: /api/health, che deve essere raggiungibile senza token
    perche' e' la sonda usata da nginx e dagli healthcheck dei container.

    Il 503 e' un esito valido: e' la risposta di require_deliveries_tablet_access
    quando la chiave del tablet non e' configurata — il gate ha funzionato.
    """
    if path.startswith("/api/health"):
        pytest.skip("sonda di health, aperta per progetto")
    response = client.get(_resolve(path))
    assert response.status_code in {401, 403, 503}, (
        f"{path} ha risposto {response.status_code} a un anonimo: gate mancante?"
    )

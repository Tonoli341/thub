"""Timer paralleli (POST /api/activity-records/active e affini).

Contratto: più timer aperti in parallelo, uno per ciascuna tripla
(employee_id, mapping_id, conflict_key): sullo stesso incrocio convivono più
timer se almeno un campo obbligatorio (es. "numero lista") ha un valore
diverso. Il 409 scatta solo sulla stessa tripla, sia che il timer esistente
sia running sia paused; il retry con lo stesso client_token è idempotente e
restituisce il timer già creato.

Area operativa e immobile vengono scelti dall'operatore a ogni avvio: l'area è
obbligatoria, l'immobile lo è solo se l'area ha immobili associati; entrambi
sono immutabili a timer avviato. GET /last-location restituisce area/immobile
del record più recente (timer aperti inclusi) per precompilare il selettore.
"""

from datetime import datetime, timedelta, timezone

from app.models import (
    ActivityRecord,
    Employee,
    FieldDefinition,
    InfinityBillingCustomerSupplierMap,
    InfinityBillingItem,
    InfinityMapFieldAssignment,
    OperationalArea,
)
from app.services.security import create_access_token
from tests.conftest import auth_headers, make_employee

MAPPING_A = "mapping-ricevimento-merce"
MAPPING_B = "mapping-preparazione-ordine"


def make_area(db, *, name="Magazzino Nichelino", area_code="NIC", buildings=None) -> str:
    area = OperationalArea(name=name, area_code=area_code, buildings=buildings or [])
    db.add(area)
    db.commit()
    return area.id


def make_mapping_with_required_field(db, *, field_key="numero_lista", field_label="Numero Lista") -> str:
    """Incrocio reale (es. Ricevimento Merce MAINA) con un campo extra obbligatorio."""
    item = InfinityBillingItem(name=f"HANDLING_IN-{field_key}")
    db.add(item)
    db.flush()
    mapping = InfinityBillingCustomerSupplierMap(
        infinity_billing_item_id=item.id,
        customer_supplier_code="MA",
        customer_supplier_description="MAINA SPA",
    )
    db.add(mapping)
    db.flush()
    definition = FieldDefinition(field_key=field_key, field_label=field_label, field_type="text")
    db.add(definition)
    db.flush()
    db.add(
        InfinityMapFieldAssignment(
            map_id=mapping.id,
            field_definition_id=definition.id,
            is_required=True,
        )
    )
    db.commit()
    return mapping.id


def make_local_user_token(db, *, tms_id: str = "13", username: str = "operatore13") -> str:
    make_employee(
        db,
        tms_id=tms_id,
        full_name="Operatore Tredici",
        local_user_username=username,
    )
    db.commit()
    return create_access_token(subject=username, role="local_user", token_type="local_user")


def start(client, token, mapping_id, area_id=None, **extra):
    payload = {"mapping_id": mapping_id, **extra}
    if area_id is not None:
        payload["operational_area_id"] = area_id
    return client.post(
        "/api/activity-records/active",
        json=payload,
        headers=auth_headers(token),
    )


def test_start_parallel_timers_on_different_mappings(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)

    first = start(client, token, MAPPING_A, area_id)
    assert first.status_code == 201
    assert first.json()["status"] == "running"

    # Con A running, B deve poter partire
    second = start(client, token, MAPPING_B, area_id)
    assert second.status_code == 201
    assert second.json()["mapping_id"] == MAPPING_B


def test_start_other_mapping_while_first_is_paused(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)

    first = start(client, token, MAPPING_A, area_id)
    assert first.status_code == 201
    paused = client.post(
        f"/api/activity-records/active/{first.json()['id']}/pause",
        headers=auth_headers(token),
    )
    assert paused.status_code == 200
    assert paused.json()["status"] == "paused"

    second = start(client, token, MAPPING_B, area_id)
    assert second.status_code == 201


def test_conflict_on_same_mapping_running_and_paused(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)

    first = start(client, token, MAPPING_A, area_id)
    assert first.status_code == 201

    # A running → 409 con campo error leggibile
    conflict = start(client, token, MAPPING_A, area_id)
    assert conflict.status_code == 409
    assert conflict.json()["error"]

    # A paused → sempre 409: paused conta come timer aperto
    client.post(
        f"/api/activity-records/active/{first.json()['id']}/pause",
        headers=auth_headers(token),
    )
    conflict = start(client, token, MAPPING_A, area_id)
    assert conflict.status_code == 409
    assert conflict.json()["error"]


def test_client_token_retry_is_idempotent(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)

    first = start(client, token, MAPPING_A, area_id, client_token="token-retry-1")
    assert first.status_code == 201

    retry = start(client, token, MAPPING_A, area_id, client_token="token-retry-1")
    assert retry.status_code == 201
    assert retry.json()["id"] == first.json()["id"]

    listing = client.get("/api/activity-records/active", headers=auth_headers(token))
    assert [r["id"] for r in listing.json()] == [first.json()["id"]]


def test_same_mapping_with_different_required_field_values(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)
    mapping_id = make_mapping_with_required_field(db_session)

    first = start(client, token, mapping_id, area_id, field_values={"numero_lista": "123"})
    assert first.status_code == 201

    # Stesso incrocio, numero lista diverso → convivono (anche con A paused)
    client.post(
        f"/api/activity-records/active/{first.json()['id']}/pause",
        headers=auth_headers(token),
    )
    second = start(client, token, mapping_id, area_id, field_values={"numero_lista": "456"})
    assert second.status_code == 201

    listing = client.get("/api/activity-records/active", headers=auth_headers(token))
    assert len(listing.json()) == 2


def test_same_mapping_with_same_required_field_value_conflicts(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)
    mapping_id = make_mapping_with_required_field(db_session)

    first = start(client, token, mapping_id, area_id, field_values={"numero_lista": "123"})
    assert first.status_code == 201

    # Normalizzazione: spazi e maiuscole non distinguono i timer
    conflict = start(client, token, mapping_id, area_id, field_values={"numero_lista": " 123 "})
    assert conflict.status_code == 409
    assert conflict.json()["error"]


def test_start_without_required_field_is_rejected(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)
    mapping_id = make_mapping_with_required_field(db_session)

    missing = start(client, token, mapping_id, area_id)
    assert missing.status_code == 422
    assert "Numero Lista" in missing.json()["detail"]

    empty = start(client, token, mapping_id, area_id, field_values={"numero_lista": "   "})
    assert empty.status_code == 422


def test_required_field_is_immutable_after_start(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)
    mapping_id = make_mapping_with_required_field(db_session)

    started = start(client, token, mapping_id, area_id, field_values={"numero_lista": "123"})
    assert started.status_code == 201
    activity_id = started.json()["id"]

    changed = client.patch(
        f"/api/activity-records/active/{activity_id}",
        json={"field_values": {"numero_lista": "999"}},
        headers=auth_headers(token),
    )
    assert changed.status_code == 422
    assert "Numero Lista" in changed.json()["detail"]

    # Stesso valore (anche non normalizzato) e campi facoltativi restano aggiornabili
    untouched = client.patch(
        f"/api/activity-records/active/{activity_id}",
        json={"field_values": {"numero_lista": " 123 ", "note": "bancale 4"}},
        headers=auth_headers(token),
    )
    assert untouched.status_code == 200
    assert untouched.json()["field_values"]["note"] == "bancale 4"


def test_pause_all_and_resume_all_with_multiple_timers(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)

    assert start(client, token, MAPPING_A, area_id).status_code == 201
    assert start(client, token, MAPPING_B, area_id).status_code == 201

    paused = client.post("/api/activity-records/active/pause-all", headers=auth_headers(token))
    assert paused.status_code == 200
    assert {r["status"] for r in paused.json()} == {"paused"}
    assert len(paused.json()) == 2

    resumed = client.post("/api/activity-records/active/resume-all", headers=auth_headers(token))
    assert resumed.status_code == 200
    assert {r["status"] for r in resumed.json()} == {"running"}
    assert len(resumed.json()) == 2


# ── Area operativa e immobile allo start ──────────────────────────────────────

def test_start_without_area_is_rejected(client, db_session):
    token = make_local_user_token(db_session)

    missing = start(client, token, MAPPING_A)
    assert missing.status_code == 422
    assert "area operativa" in missing.json()["detail"].lower()

    unknown = start(client, token, MAPPING_A, "area-inesistente")
    assert unknown.status_code == 422


def test_building_required_only_when_area_has_buildings(client, db_session):
    token = make_local_user_token(db_session)
    area_with = make_area(
        db_session,
        name="Magazzino Anagnina",
        area_code="ANA",
        buildings=[
            {"code": "A1", "visible_in_reporting": True},
            {"code": "B2", "visible_in_reporting": False},
        ],
    )
    area_without = make_area(db_session, name="Cantiere Esterno", area_code="EXT")

    # Area con immobili: immobile obbligatorio
    missing = start(client, token, MAPPING_A, area_with)
    assert missing.status_code == 422
    assert "immobile" in missing.json()["detail"].lower()

    # Immobile di un'altra area / non visibile in rendicontazione → 422
    wrong = start(client, token, MAPPING_A, area_with, building="X9")
    assert wrong.status_code == 422
    hidden = start(client, token, MAPPING_A, area_with, building="B2")
    assert hidden.status_code == 422

    # Immobile valido: accettato e normalizzato (maiuscole/spazi)
    ok = start(client, token, MAPPING_A, area_with, building=" a1 ")
    assert ok.status_code == 201
    assert ok.json()["building"] == "A1"

    # Area senza immobili: immobile facoltativo, ma se inviato deve appartenere all'area
    ok_without = start(client, token, MAPPING_B, area_without)
    assert ok_without.status_code == 201
    assert ok_without.json()["building"] is None

    extraneous = start(client, token, MAPPING_A, area_without, building="A1")
    assert extraneous.status_code == 422


def test_area_and_building_are_immutable_after_start(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session, buildings=[{"code": "A1", "visible_in_reporting": True}])
    other_area_id = make_area(db_session, name="Magazzino Anagnina", area_code="ANA")

    started = start(client, token, MAPPING_A, area_id, building="A1")
    assert started.status_code == 201
    activity_id = started.json()["id"]

    changed_area = client.patch(
        f"/api/activity-records/active/{activity_id}",
        json={"operational_area_id": other_area_id},
        headers=auth_headers(token),
    )
    assert changed_area.status_code == 422

    changed_building = client.patch(
        f"/api/activity-records/active/{activity_id}",
        json={"building": "B2"},
        headers=auth_headers(token),
    )
    assert changed_building.status_code == 422

    # Rimandare gli stessi valori (anche non normalizzati) non è un errore
    same = client.patch(
        f"/api/activity-records/active/{activity_id}",
        json={"operational_area_id": area_id, "building": " a1 ", "field_values": {"note": "ok"}},
        headers=auth_headers(token),
    )
    assert same.status_code == 200
    assert same.json()["building"] == "A1"


def test_active_responses_include_area_name(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session, name="Magazzino Nichelino")

    started = start(client, token, MAPPING_A, area_id)
    assert started.status_code == 201
    assert started.json()["operational_area_name"] == "Magazzino Nichelino"

    listing = client.get("/api/activity-records/active", headers=auth_headers(token))
    assert listing.json()[0]["operational_area_name"] == "Magazzino Nichelino"
    assert listing.json()[0]["operational_area_id"] == area_id

    detail = client.get(
        f"/api/activity-records/active/{started.json()['id']}",
        headers=auth_headers(token),
    )
    assert detail.json()["operational_area_name"] == "Magazzino Nichelino"


# ── GET /last-location ─────────────────────────────────────────────────────────

def last_location(client, token):
    return client.get("/api/activity-records/last-location", headers=auth_headers(token))


def test_last_location_without_history_returns_nulls(client, db_session):
    token = make_local_user_token(db_session)

    response = last_location(client, token)
    assert response.status_code == 200
    assert response.json() == {
        "operational_area_id": None,
        "operational_area_name": None,
        "building": None,
        "worked_at": None,
    }


def test_last_location_returns_most_recent_closed_record(client, db_session):
    token = make_local_user_token(db_session)
    employee = make_employee(db_session, tms_id="14", full_name="Operatore Quattordici")
    area_id = make_area(db_session)
    older = datetime(2026, 7, 15, 8, 0, tzinfo=timezone.utc)
    newer = datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc)

    # employee del token = "13": recupera l'id reale dal db
    me = db_session.query(Employee).filter(Employee.local_user_username == "operatore13").one()
    for started_at, building in ((older, "A1"), (newer, "B2")):
        db_session.add(
            ActivityRecord(
                employee_id=me.id,
                mapping_id=MAPPING_A,
                operational_area_id=area_id,
                building=building,
                started_at=started_at,
                ended_at=started_at + timedelta(hours=1),
                duration_seconds=3600,
                field_values={},
            )
        )
    # Record più recente di un altro dipendente: non deve influire
    db_session.add(
        ActivityRecord(
            employee_id=employee.id,
            mapping_id=MAPPING_A,
            operational_area_id=area_id,
            building="Z9",
            started_at=newer + timedelta(hours=2),
            ended_at=newer + timedelta(hours=3),
            duration_seconds=3600,
            field_values={},
        )
    )
    db_session.commit()

    body = last_location(client, token).json()
    assert body["operational_area_id"] == area_id
    assert body["operational_area_name"] == "Magazzino Nichelino"
    assert body["building"] == "B2"
    assert body["worked_at"].startswith("2026-07-16T08:00:00")


def test_last_location_includes_open_timers(client, db_session):
    token = make_local_user_token(db_session)
    area_id = make_area(db_session)
    newer_area_id = make_area(db_session, name="Magazzino Anagnina", area_code="ANA")

    # Timer aperto (started_at nel passato, così la close ha durata > 0):
    # last-location deve vederlo anche prima della chiusura.
    started_at = (datetime.now(timezone.utc) - timedelta(hours=1)).isoformat()
    started = start(client, token, MAPPING_A, newer_area_id, started_at=started_at)
    assert started.status_code == 201

    body = last_location(client, token).json()
    assert body["operational_area_id"] == newer_area_id
    assert body["operational_area_name"] == "Magazzino Anagnina"
    assert body["building"] is None
    assert body["worked_at"] is not None

    # Alla chiusura il timer diventa un ActivityRecord: last-location non cambia
    closed = client.post(
        f"/api/activity-records/active/{started.json()['id']}/close",
        json={},
        headers=auth_headers(token),
    )
    assert closed.status_code == 201
    body = last_location(client, token).json()
    assert body["operational_area_id"] == newer_area_id
    assert area_id != newer_area_id

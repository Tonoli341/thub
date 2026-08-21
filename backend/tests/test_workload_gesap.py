from datetime import date

from app.models import Team, TeamDailyNote
from tests.conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def _booking(
    *,
    booking_id: int = 215,
    work_date: str = "2026-08-19",
    movement: str = "IN",
    status: str = "PRENOTATO",
    customer: str = "Cliente Uno",
    supplier: str = "Fornitore Uno",
    warehouse: str = "Hub Verzuolo",
) -> dict:
    return {
        "id": booking_id,
        "tipo_movimento": movement,
        "stato": status,
        "cliente": {"id": "CLI", "nome": customer},
        "fornitore": {"id": "FOR", "nome": supplier},
        "vettore": "Vettore Test",
        "prenotazione": {"data": work_date, "ora": "08:30"},
        "sede": {"codice": "KI", "nome": warehouse},
        "note": "Scarico prioritario",
    }


def _payload(item: dict | None, work_date: str = "2026-08-19") -> dict:
    items = [item] if item else []
    return {"data_riferimento": work_date, "count": len(items), "items": items}


def _setup(db_session):
    team = Team(name="Squadra Carichi", icon="📦", color="#007040")
    db_session.add(team)
    db_session.commit()
    token = make_admin_token(db_session)
    return team, auth_headers(token)


def test_importa_prenotazione_e_impedisce_duplicati(client, db_session, monkeypatch):
    team, headers = _setup(db_session)
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(_booking()))

    body = {"team_id": team.id, "work_date": "2026-08-19", "booking_id": "215"}
    response = client.post("/api/workloads/gesap/import", json=body, headers=headers)
    assert response.status_code == 200, response.text

    note = db_session.query(TeamDailyNote).one()
    row = note.table_rows[0]
    assert row["customer_name"] == "Cliente Uno"
    assert row["supplier_name"] == "Fornitore Uno"
    assert row["warehouse"] is None  # il magazzino non arriva da ToolTo: si sceglie nei Carichi
    assert row["inbound_count"] == 1
    assert row["outbound_count"] == 0
    assert row["pallet_count"] == 0
    assert row["gesap_booking_id"] == "215"

    duplicate = client.post("/api/workloads/gesap/import", json=body, headers=headers)
    assert duplicate.status_code == 409


def test_riga_toolto_accetta_pallet_e_magazzino_e_non_puo_essere_eliminata(client, db_session, monkeypatch):
    team, headers = _setup(db_session)
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(_booking()))
    body = {"team_id": team.id, "work_date": "2026-08-19", "booking_id": "215"}
    assert client.post("/api/workloads/gesap/import", json=body, headers=headers).status_code == 200

    note = db_session.query(TeamDailyNote).one()
    row = dict(note.table_rows[0])
    row.update({"customer_name": "Alterato", "inbound_count": 99, "warehouse": "Altrove", "pallet_count": 12})
    response = client.put(
        f"/api/workloads/teams/{team.id}/daily-notes/2026-08-19",
        json={"rows": [row]},
        headers=headers,
    )
    assert response.status_code == 200, response.text
    saved = response.json()["rows"][0]
    assert saved["customer_name"] == "Cliente Uno"
    assert saved["inbound_count"] == 1
    assert saved["warehouse"] == "Altrove"
    assert saved["pallet_count"] == 12

    omitted = client.put(
        f"/api/workloads/teams/{team.id}/daily-notes/2026-08-19",
        json={"rows": []},
        headers=headers,
    )
    assert omitted.status_code == 200
    assert len(omitted.json()["rows"]) == 1


def test_sincronizza_modifiche_e_sposta_data_conservando_squadra_e_pallet(client, db_session, monkeypatch):
    team, headers = _setup(db_session)
    current = _booking()
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(current))
    body = {"team_id": team.id, "work_date": "2026-08-19", "booking_id": "215"}
    assert client.post("/api/workloads/gesap/import", json=body, headers=headers).status_code == 200

    note = db_session.query(TeamDailyNote).one()
    row = dict(note.table_rows[0])
    row["pallet_count"] = 7
    row["warehouse"] = "Hub Manuale"
    assert client.put(
        f"/api/workloads/teams/{team.id}/daily-notes/2026-08-19",
        json={"rows": [row]},
        headers=headers,
    ).status_code == 200

    moved = _booking(
        work_date="2026-08-20",
        movement="OUT",
        customer="Cliente Aggiornato",
        warehouse="Hub Fossano",
    )
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(moved, "2026-08-20"))
    response = client.post("/api/workloads/gesap/sync?work_date=2026-08-20", headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()["items"][0]["workload_imported"] is True

    old_note = db_session.query(TeamDailyNote).filter_by(work_date=date(2026, 8, 19)).one()
    new_note = db_session.query(TeamDailyNote).filter_by(work_date=date(2026, 8, 20)).one()
    assert old_note.table_rows == []
    saved = new_note.table_rows[0]
    assert new_note.team_id == team.id
    assert saved["customer_name"] == "Cliente Aggiornato"
    assert saved["warehouse"] == "Hub Manuale"
    assert saved["inbound_count"] == 0
    assert saved["outbound_count"] == 1
    assert saved["pallet_count"] == 7


def test_sincronizzazione_elimina_prenotazioni_assenti_o_annullate(client, db_session, monkeypatch):
    team, headers = _setup(db_session)
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(_booking()))
    body = {"team_id": team.id, "work_date": "2026-08-19", "booking_id": "215"}
    assert client.post("/api/workloads/gesap/import", json=body, headers=headers).status_code == 200

    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(None))
    response = client.post("/api/workloads/gesap/sync?work_date=2026-08-19", headers=headers)
    assert response.status_code == 200
    assert response.json()["sync"]["deleted"] == 1
    assert db_session.query(TeamDailyNote).one().table_rows == []

    active_216 = _booking(booking_id=216)
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(active_216))
    imported = client.post(
        "/api/workloads/gesap/import",
        json={"team_id": team.id, "work_date": "2026-08-19", "booking_id": "216"},
        headers=headers,
    )
    assert imported.status_code == 200

    monkeypatch.setattr(
        "app.api.workloads.fetch_prenotazioni",
        lambda _date: _payload(_booking(booking_id=216, status="ANNULLATO")),
    )
    cancelled = client.post("/api/workloads/gesap/sync?work_date=2026-08-19", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["sync"]["deleted"] == 1
    assert db_session.query(TeamDailyNote).one().table_rows == []


def test_sync_non_cancella_se_toolto_non_risponde(client, db_session, monkeypatch):
    team, headers = _setup(db_session)
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(_booking()))
    body = {"team_id": team.id, "work_date": "2026-08-19", "booking_id": "215"}
    assert client.post("/api/workloads/gesap/import", json=body, headers=headers).status_code == 200

    def unavailable(_date):
        raise TimeoutError("timeout")

    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", unavailable)
    response = client.post("/api/workloads/gesap/sync?work_date=2026-08-19", headers=headers)
    assert response.status_code == 502
    assert len(db_session.query(TeamDailyNote).one().table_rows) == 1


def test_endpoint_gesap_carichi_richiede_accesso_ai_carichi(client, db_session, monkeypatch):
    employee = make_employee(
        db_session,
        tms_id="GESAP-NO",
        full_name="Utente senza carichi",
        config_can_access_workloads=False,
    )
    token = make_linked_user_token(db_session, employee, username="gesap-no-workloads")
    monkeypatch.setattr("app.api.workloads.fetch_prenotazioni", lambda _date: _payload(_booking()))

    response = client.post(
        "/api/workloads/gesap/sync?work_date=2026-08-19",
        headers=auth_headers(token),
    )
    assert response.status_code == 403

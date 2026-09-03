from datetime import date, timedelta

from tests.conftest import auth_headers, make_admin_token


def _create_asset(client, headers, tracks_usage_hours: bool = False, deadline_type_options=()):
    asset_class = client.post(
        "/api/maintenance/asset-classes",
        json={"code": "carrello_elevatore", "label": "Carrello elevatore"},
        headers=headers,
    ).json()
    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale", "label": "Frontale", "tracks_usage_hours": tracks_usage_hours},
        headers=headers,
    ).json()
    if deadline_type_options:
        client.patch(
            f"/api/maintenance/asset-types/{asset_type['id']}",
            json={"deadline_type_options": list(deadline_type_options)},
            headers=headers,
        )
    asset = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {}},
        headers=headers,
    ).json()
    return asset


def test_urgency_thresholds(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(
        client, headers, deadline_type_options=("verifica_forche", "verifica_catene", "ispezione_pluriennale")
    )
    today = date.today()

    overdue = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "verifica_forche", "due_date": (today - timedelta(days=1)).isoformat()},
        headers=headers,
    ).json()
    assert overdue["urgency"] == "scaduta"
    assert overdue["asset_class_label"] == "Carrello elevatore"
    assert overdue["asset_type_label"] == "Frontale"

    urgent = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={
            "deadline_type": "verifica_catene",
            "due_date": (today + timedelta(days=5)).isoformat(),
            "notice_thresholds_days": [30, 15, 7],
        },
        headers=headers,
    ).json()
    assert urgent["urgency"] == "urgente"

    regular = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "ispezione_pluriennale", "due_date": (today + timedelta(days=90)).isoformat()},
        headers=headers,
    ).json()
    assert regular["urgency"] == "regolare"


def test_recurrence_from_completed_date_shifts_next_due_date(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, deadline_type_options=("verifica_trimestrale",))
    due_date = date(2026, 1, 1)

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={
            "deadline_type": "verifica_trimestrale",
            "due_date": due_date.isoformat(),
            "recurrence_basis": "da_effettiva",
            "recurrence_days": 90,
        },
        headers=headers,
    ).json()

    completed_late = date(2026, 1, 20)  # completato con 19 giorni di ritardo
    resp = client.post(
        f"/api/maintenance/deadlines/{deadline['id']}/complete",
        json={"completed_date": completed_late.isoformat(), "confirm_next_due_date": True},
        headers=headers,
    )
    assert resp.status_code == 200
    updated = resp.json()
    # decorre dalla data effettiva, non da quella prevista: slitta in avanti
    assert updated["due_date"] == (completed_late + timedelta(days=90)).isoformat()


def test_completion_does_not_advance_due_date_without_confirmation(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, deadline_type_options=("verifica_trimestrale",))
    due_date = date(2026, 3, 1)

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={
            "deadline_type": "verifica_trimestrale",
            "due_date": due_date.isoformat(),
            "recurrence_basis": "da_effettiva",
            "recurrence_days": 90,
        },
        headers=headers,
    ).json()

    resp = client.post(
        f"/api/maintenance/deadlines/{deadline['id']}/complete",
        json={"completed_date": "2026-03-01", "confirm_next_due_date": False},
        headers=headers,
    )
    assert resp.json()["due_date"] == due_date.isoformat()
    assert resp.json()["last_completed_at"] == "2026-03-01"


def test_postpone_requires_reason(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, deadline_type_options=("ispezione",))

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "ispezione", "due_date": "2026-06-01"},
        headers=headers,
    ).json()

    resp = client.post(
        f"/api/maintenance/deadlines/{deadline['id']}/postpone",
        json={"new_due_date": "2026-07-01", "reason": ""},
        headers=headers,
    )
    assert resp.status_code == 422  # min_length=1 sullo schema

    resp = client.post(
        f"/api/maintenance/deadlines/{deadline['id']}/postpone",
        json={"new_due_date": "2026-07-01", "reason": "Fornitore non disponibile"},
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["due_date"] == "2026-07-01"
    assert resp.json()["postponed_reason"] == "Fornitore non disponibile"


def test_due_hours_rejected_when_type_does_not_track_usage_hours(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, tracks_usage_hours=False, deadline_type_options=("tagliando",))

    resp = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "tagliando", "due_date": "2030-01-01", "due_hours": 500},
        headers=headers,
    )
    assert resp.status_code == 400


def test_due_hours_projection_from_counter_readings(client, db_session):
    """`due_hours` è una soglia relativa alle ore all'ultima manutenzione, non
    al totale storico del contaore: con un asset già a 200 ore quando la
    scadenza viene creata, +500 ore deve proiettare da 200+500=700, non da 500
    (altrimenti una soglia già superata dal totale storico risulterebbe
    "scaduta" fin da subito, il bug segnalato)."""
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, tracks_usage_hours=True, deadline_type_options=("tagliando_500_ore",))
    today = date.today()
    reading_1 = today - timedelta(days=10)
    reading_2 = today

    client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": reading_1.isoformat(), "value": 100, "unit": "ore"},
        headers=headers,
    )
    client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": reading_2.isoformat(), "value": 200, "unit": "ore"},
        headers=headers,
    )

    # Baseline catturata alla creazione: 200 ore (ultima lettura contaore).
    # Ritmo stimato: 10 ore/giorno, soglia relativa 500 ore -> 700 ore assolute,
    # cioè 50 giorni da oggi (500 ore mancanti / 10 ore al giorno).
    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={
            "deadline_type": "tagliando_500_ore",
            "due_date": "2099-01-01",
            "due_hours": 500,
            "notice_thresholds_days": [30, 15, 7],
        },
        headers=headers,
    ).json()
    assert deadline["last_completed_hours"] == 200.0
    assert deadline["current_hours"] == 200.0
    assert deadline["projected_due_date"] == (today + timedelta(days=50)).isoformat()
    assert deadline["urgency"] == "regolare"


def test_due_hours_threshold_is_relative_to_last_completion(client, db_session):
    """Dopo un completamento con `completed_hours`, la soglia a ore si
    ricalcola dalla nuova baseline (non dal totale storico del contaore)."""
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, tracks_usage_hours=True, deadline_type_options=("tagliando_1000_ore",))
    today = date.today()

    client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": today.isoformat(), "value": 5000, "unit": "ore"},
        headers=headers,
    )

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={
            "deadline_type": "tagliando_1000_ore",
            "due_date": "2027-03-23",
            "due_hours": 1000,
            "recurrence_hours": 1000,
        },
        headers=headers,
    ).json()
    # Baseline = 5000 ore correnti, non ancora scaduta (5000 < 5000+1000).
    assert deadline["urgency"] != "scaduta"

    completed = client.post(
        f"/api/maintenance/deadlines/{deadline['id']}/complete",
        json={"completed_date": today.isoformat(), "completed_hours": 5100, "confirm_next_due_date": True},
        headers=headers,
    ).json()
    assert completed["last_completed_hours"] == 5100.0
    assert completed["due_hours"] == 1000.0

    client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": (today + timedelta(days=1)).isoformat(), "value": 6099, "unit": "ore"},
        headers=headers,
    )
    still_ok = client.get(f"/api/maintenance/assets/{asset['id']}/deadlines", headers=headers).json()[0]
    assert still_ok["urgency"] != "scaduta"  # 6099 < 5100 + 1000

    client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": (today + timedelta(days=2)).isoformat(), "value": 6100, "unit": "ore"},
        headers=headers,
    )
    now_overdue = client.get(f"/api/maintenance/assets/{asset['id']}/deadlines", headers=headers).json()[0]
    assert now_overdue["urgency"] == "scaduta"  # 6100 >= 5100 + 1000


def test_bell_notification_and_ack(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, deadline_type_options=("verifica_scaduta",))

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "verifica_scaduta", "due_date": "2020-01-01"},
        headers=headers,
    ).json()

    notifications = client.get("/api/notifications", headers=headers).json()
    maintenance_notifications = [n for n in notifications if n["category"] == "maintenance_deadline"]
    assert len(maintenance_notifications) == 1
    assert asset["internal_code"] in maintenance_notifications[0]["message"]

    ack_resp = client.post(f"/api/maintenance/deadlines/{deadline['id']}/ack", headers=headers)
    assert ack_resp.status_code == 204

    notifications_after_ack = client.get("/api/notifications", headers=headers).json()
    assert not [n for n in notifications_after_ack if n["category"] == "maintenance_deadline"]


def test_create_rejects_deadline_type_not_in_asset_type_options(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, deadline_type_options=("revisione_annuale",))

    resp = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "inesistente", "due_date": "2030-01-01"},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "non riconosciuto" in resp.json()["detail"]

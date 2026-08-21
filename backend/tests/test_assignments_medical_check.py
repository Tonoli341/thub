"""Causale VISITA_IDONEITA sul Planner.

Il gate deve valere sia in creazione sia in modifica: solo sul create si
aggirerebbe cambiando la causale di un blocco gia' salvato.
"""

from datetime import date

from app.models import Assignment

from .conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token

WORK_DATE = date(2026, 9, 1).isoformat()


def _visit_payload(employee_id: str) -> dict:
    return {
        "employee_id": employee_id,
        "work_date": WORK_DATE,
        "start_time": "09:00",
        "end_time": "10:30",
        "cause": "VISITA_IDONEITA",
        "area": "Kimberly",
        "immobile": "K1",
    }


def _make_manager_with_report(db):
    manager = make_employee(db, tms_id="M1", full_name="Capo Squadra", planner_access_level="team_write")
    report = make_employee(db, tms_id="R1", full_name="Collaboratore Uno", manager_employee_id=manager.id)
    db.commit()
    return manager, report


def test_manager_can_create_medical_check_without_building(client, db_session):
    manager, report = _make_manager_with_report(db_session)
    token = make_linked_user_token(db_session, manager, username="capo.squadra")

    response = client.post("/api/assignments", headers=auth_headers(token), json=_visit_payload(report.id))

    assert response.status_code == 201, response.text
    body = response.json()
    assert body["cause"] == "VISITA_IDONEITA"
    # La visita non e' lavoro su un immobile: building e immobile vengono azzerati.
    assert body["area"] is None
    assert body["immobile"] is None
    assert body["training_course_id"] is None


def test_admin_can_create_medical_check(client, db_session):
    worker = make_employee(db_session, tms_id="W1", full_name="Mario Rossi")
    db_session.commit()
    token = make_admin_token(db_session)

    response = client.post("/api/assignments", headers=auth_headers(token), json=_visit_payload(worker.id))

    assert response.status_code == 201, response.text


def test_collaborator_cannot_create_medical_check(client, db_session):
    worker = make_employee(db_session, tms_id="C1", full_name="Solo Se Stesso", planner_access_level="team_write")
    db_session.commit()
    token = make_linked_user_token(db_session, worker, username="collaboratore.uno")

    response = client.post("/api/assignments", headers=auth_headers(token), json=_visit_payload(worker.id))

    assert response.status_code == 403
    assert "visita di idoneità" in response.json()["detail"].lower()

    # ...ma la presenza ordinaria resta consentita.
    presence = _visit_payload(worker.id) | {"cause": "PRESENZA", "area": None, "immobile": None}
    assert client.post("/api/assignments", headers=auth_headers(token), json=presence).status_code == 201


def test_collaborator_cannot_turn_own_presence_into_medical_check(client, db_session):
    worker = make_employee(db_session, tms_id="C2", full_name="Furbo Uno", planner_access_level="team_write")
    db_session.commit()
    token = make_linked_user_token(db_session, worker, username="collaboratore.due")
    created = client.post(
        "/api/assignments",
        headers=auth_headers(token),
        json=_visit_payload(worker.id) | {"cause": "PRESENZA", "area": None, "immobile": None},
    )
    assert created.status_code == 201

    response = client.put(
        f"/api/assignments/{created.json()['id']}",
        headers=auth_headers(token),
        json={"cause": "VISITA_IDONEITA"},
    )

    assert response.status_code == 403
    assert db_session.get(Assignment, created.json()["id"]).cause.value == "PRESENZA"


def test_collaborator_cannot_edit_an_existing_medical_check(client, db_session):
    manager, report = _make_manager_with_report(db_session)
    manager_token = make_linked_user_token(db_session, manager, username="capo.due")
    created = client.post("/api/assignments", headers=auth_headers(manager_token), json=_visit_payload(report.id))
    assert created.status_code == 201

    report.planner_access_level = "team_write"
    db_session.commit()
    report_token = make_linked_user_token(db_session, report, username="collaboratore.tre")

    response = client.put(
        f"/api/assignments/{created.json()['id']}",
        headers=auth_headers(report_token),
        json={"notes": "sposto io"},
    )

    assert response.status_code == 403

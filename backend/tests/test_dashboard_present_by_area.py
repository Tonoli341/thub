"""Raggruppamento "In Planner oggi · per area operativa".

Chi nella stessa giornata lavora su piu' immobili deve comparire in ognuno con
la propria fascia oraria: dalla home, senza l'orario, non si capisce quando la
persona sta in K1 e quando in K2. Chi ha una sola allocazione non porta orario.
"""

from datetime import date, time

from app.enums import AssignmentCause
from app.models import Assignment

from tests.conftest import auth_headers, make_admin_token, make_employee

DAY = date(2026, 8, 21)


def _assignment(employee_id: str, area: str, immobile: str, start: time, end: time) -> Assignment:
    return Assignment(
        employee_id=employee_id,
        work_date=DAY,
        start_time=start,
        end_time=end,
        cause=AssignmentCause.presence,
        area=area,
        immobile=immobile,
    )


def test_present_by_area_mostra_l_orario_solo_a_chi_ha_piu_allocazioni(client, db_session):
    worker = make_employee(db_session, tms_id="T1", full_name="Mario Rossi")
    other = make_employee(db_session, tms_id="T2", full_name="Anna Ferrari")
    db_session.add_all([
        _assignment(worker.id, "Kimberly", "K1", time(5, 0), time(13, 0)),
        _assignment(worker.id, "Kimberly", "K2", time(13, 0), time(21, 0)),
        _assignment(other.id, "Kimberly", "K1", time(6, 0), time(14, 0)),
    ])
    token = make_admin_token(db_session)
    db_session.commit()

    response = client.get(f"/api/dashboard?date={DAY.isoformat()}", headers=auth_headers(token))
    assert response.status_code == 200

    by_area = {item["employee_name"]: item for item in response.json()["present_by_area"]}
    assert set(by_area) == {"Kimberly K1", "Kimberly K2"}

    # Anna Ferrari ha un turno solo: niente orario. Mario Rossi si sposta: orario.
    k1_people = [(p["employee_name"], p["time_range"]) for p in by_area["Kimberly K1"]["people"]]
    assert k1_people == [("Anna Ferrari", None), ("Mario Rossi", "05:00-13:00")]

    k2_people = [(p["employee_name"], p["time_range"]) for p in by_area["Kimberly K2"]["people"]]
    assert k2_people == [("Mario Rossi", "13:00-21:00")]

    # "info" resta l'elenco dei soli nomi, per i client che non leggono "people".
    assert by_area["Kimberly K1"]["info"] == "Anna Ferrari, Mario Rossi"


def test_present_by_area_raccoglie_le_allocazioni_senza_area(client, db_session):
    worker = make_employee(db_session, tms_id="T3", full_name="Luca Bianchi")
    db_session.add(
        Assignment(
            employee_id=worker.id,
            work_date=DAY,
            start_time=time(8, 0),
            end_time=time(17, 0),
            cause=AssignmentCause.presence,
        )
    )
    token = make_admin_token(db_session)
    db_session.commit()

    response = client.get(f"/api/dashboard?date={DAY.isoformat()}", headers=auth_headers(token))
    assert response.status_code == 200

    by_area = {item["employee_name"]: item for item in response.json()["present_by_area"]}
    assert list(by_area) == ["Senza area"]
    assert by_area["Senza area"]["people"] == [
        {"employee_id": worker.id, "employee_name": "Luca Bianchi", "time_range": None}
    ]

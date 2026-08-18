import io
from datetime import date, timedelta

from openpyxl import load_workbook

from app.models import AuditLog, EmployeeAbsenceBalance, EmployeeAbsenceBalanceStatus

from .conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def test_hr_can_read_zero_balances_but_cannot_write_without_flag(client, db_session):
    hr = make_employee(db_session, tms_id="HR1", full_name="Risorse Umane", app_role="HR")
    worker = make_employee(db_session, tms_id="W1", full_name="Mario Rossi")
    token = make_linked_user_token(db_session, hr, username="hr.user")

    response = client.get("/api/absence-balances", headers=auth_headers(token))
    assert response.status_code == 200
    worker_row = next(row for row in response.json() if row["employee_id"] == worker.id)
    assert worker_row["permission_hours"] == 0
    assert worker_row["vacation_days"] == 0
    assert worker_row["last_modified_at"] is None
    assert worker_row["last_modified_by"] is None

    response = client.put(
        f"/api/absence-balances/{worker.id}",
        headers=auth_headers(token),
        json={"permission_hours": 8, "vacation_days": 2},
    )
    assert response.status_code == 403


def test_enabled_hr_can_update_balance_and_audit_is_recorded(client, db_session):
    hr = make_employee(
        db_session,
        tms_id="HR2",
        full_name="HR Abilitato",
        app_role="HR",
        absence_can_edit_balances=True,
    )
    worker = make_employee(db_session, tms_id="W2", full_name="Giulia Bianchi")
    token = make_linked_user_token(db_session, hr, username="hr.enabled")

    response = client.put(
        f"/api/absence-balances/{worker.id}",
        headers=auth_headers(token),
        json={"permission_hours": "12.50", "vacation_days": "4.25"},
    )
    assert response.status_code == 200
    assert response.json()["permission_hours"] == 12.5
    assert response.json()["vacation_days"] == 4.25
    assert response.json()["last_modified_by"] == "hr.enabled"

    balance = db_session.get(EmployeeAbsenceBalance, worker.id)
    assert str(balance.permission_hours) == "12.50"
    assert str(balance.vacation_days) == "4.25"
    audit = db_session.query(AuditLog).filter(AuditLog.entity == "employee_absence_balance").one()
    assert audit.detail["employee_id"] == worker.id
    assert audit.detail["before"] == {"permission_hours": "0.00", "vacation_days": "0.00"}
    assert audit.detail["after"] == {"permission_hours": "12.50", "vacation_days": "4.25"}


def test_enabled_hr_can_set_negative_balances(client, db_session):
    hr = make_employee(
        db_session,
        tms_id="HR-NEG",
        full_name="HR Valori Negativi",
        app_role="HR",
        absence_can_edit_balances=True,
    )
    worker = make_employee(db_session, tms_id="W-NEG", full_name="Residui Negativi")
    token = make_linked_user_token(db_session, hr, username="hr.negative")

    response = client.put(
        f"/api/absence-balances/{worker.id}",
        headers=auth_headers(token),
        json={"permission_hours": "-12.50", "vacation_days": "-4.25"},
    )

    assert response.status_code == 200
    assert response.json()["permission_hours"] == -12.5
    assert response.json()["vacation_days"] == -4.25


def test_collaborator_can_only_read_own_balance(client, db_session):
    worker = make_employee(db_session, tms_id="W3", full_name="Luca Verdi")
    other = make_employee(db_session, tms_id="W4", full_name="Anna Neri")
    token = make_linked_user_token(db_session, worker, username="worker.user")

    own_response = client.get(f"/api/absence-balances/{worker.id}", headers=auth_headers(token))
    assert own_response.status_code == 200
    assert own_response.json()["permission_hours"] == 0

    other_response = client.get(f"/api/absence-balances/{other.id}", headers=auth_headers(token))
    assert other_response.status_code == 403
    list_response = client.get("/api/absence-balances", headers=auth_headers(token))
    assert list_response.status_code == 403


def test_balance_edit_flag_cannot_be_enabled_for_non_hr_employee(client, db_session):
    worker = make_employee(db_session, tms_id="W5", full_name="Utente Standard")
    token = make_admin_token(db_session)
    response = client.patch(
        f"/api/employees/{worker.id}/absence-permissions",
        headers=auth_headers(token),
        json={
            "absence_can_request_for_self": True,
            "absence_can_request_for_reports": False,
            "absence_can_request_for_all": False,
            "absence_can_view_all": False,
            "absence_can_edit_balances": True,
            "absence_allowed_role_descriptions": [],
            "absence_requires_approval": True,
            "absence_approver_1_employee_id": None,
            "absence_approver_2_employee_id": None,
            "absence_approver_3_employee_id": None,
        },
    )
    assert response.status_code == 400


def test_export_is_an_xlsx_for_hr(client, db_session):
    hr = make_employee(db_session, tms_id="HR3", full_name="HR Export", app_role="HR")
    make_employee(db_session, tms_id="W6", full_name="Dipendente Export")
    token = make_linked_user_token(db_session, hr, username="hr.export")

    response = client.get("/api/absence-balances/export", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert response.content[:2] == b"PK"
    sheet = load_workbook(io.BytesIO(response.content)).active
    assert [cell.value for cell in sheet[1]] == [
        "Dipendente",
        "Matricola",
        "Ferie (GG)",
        "Permessi (Ore)",
        "Ultima Modifica",
        "Utente Ultima Modifica",
    ]


def test_enabled_hr_commits_balances_and_general_update_date_atomically(client, db_session):
    hr = make_employee(
        db_session,
        tms_id="HR-COMMIT",
        full_name="HR Commit",
        app_role="HR",
        absence_can_edit_balances=True,
    )
    first = make_employee(db_session, tms_id="W-COMMIT-1", full_name="Primo Dipendente")
    second = make_employee(db_session, tms_id="W-COMMIT-2", full_name="Secondo Dipendente")
    token = make_linked_user_token(db_session, hr, username="hr.commit")
    expected_date = date.today().replace(day=1) - timedelta(days=1)

    response = client.post(
        "/api/absence-balances/commit",
        headers=auth_headers(token),
        json={
            "updated_through": expected_date.isoformat(),
            "changes": [
                {"employee_id": first.id, "permission_hours": "8.50", "vacation_days": "3.25"},
                {"employee_id": second.id, "permission_hours": "4.00", "vacation_days": "1.00"},
            ],
        },
    )

    assert response.status_code == 200
    assert response.json()["updated_through"] == expected_date.isoformat()
    assert len(response.json()["balances"]) == 2
    status_row = db_session.get(EmployeeAbsenceBalanceStatus, 1)
    assert status_row.updated_through == expected_date
    assert status_row.updated_by_name == "hr.commit"

    status_response = client.get("/api/absence-balances/status", headers=auth_headers(token))
    assert status_response.status_code == 200
    assert status_response.json()["updated_through"] == expected_date.isoformat()
    assert status_response.json()["last_modified_by"] == "hr.commit"


def test_commit_rejects_wrong_general_update_date_without_saving_balances(client, db_session):
    hr = make_employee(
        db_session,
        tms_id="HR-DATE",
        full_name="HR Data Errata",
        app_role="HR",
        absence_can_edit_balances=True,
    )
    worker = make_employee(db_session, tms_id="W-DATE", full_name="Dipendente Data Errata")
    token = make_linked_user_token(db_session, hr, username="hr.wrong-date")
    wrong_date = date.today().replace(day=1)

    response = client.post(
        "/api/absence-balances/commit",
        headers=auth_headers(token),
        json={
            "updated_through": wrong_date.isoformat(),
            "changes": [
                {"employee_id": worker.id, "permission_hours": 8, "vacation_days": 2},
            ],
        },
    )

    assert response.status_code == 400
    assert db_session.get(EmployeeAbsenceBalance, worker.id) is None
    assert db_session.get(EmployeeAbsenceBalanceStatus, 1) is None

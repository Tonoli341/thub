from datetime import date, timedelta
from types import SimpleNamespace

from tests.conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def _expiration(employee, *, days=5):
    return (
        employee.id,
        employee.full_name,
        [
            SimpleNamespace(
                expiration_date=date.today() + timedelta(days=days),
                type_description="Patente",
                type_code="PAT",
                document_number=f"DOC-{employee.tms_id}",
            )
        ],
    )


def test_reports_scope_includes_direct_and_indirect_reports_only(client, db_session, monkeypatch):
    manager = make_employee(
        db_session,
        tms_id="MGR",
        full_name="Manager",
        config_expirations_scope="reports",
        config_can_access_expirations=True,
    )
    direct = make_employee(
        db_session,
        tms_id="DIRECT",
        full_name="Riporto Diretto",
        manager_employee_id=manager.id,
    )
    indirect = make_employee(
        db_session,
        tms_id="INDIRECT",
        full_name="Riporto Indiretto",
        manager_employee_id=direct.id,
    )
    outsider = make_employee(db_session, tms_id="OUT", full_name="Fuori Team")
    token = make_linked_user_token(db_session, manager, username="manager")

    by_code = {
        employee.tms_id: _expiration(employee)
        for employee in (manager, direct, indirect, outsider)
    }
    monkeypatch.setattr("app.api.dashboard._get_expirations_by_code", lambda _db: by_code)

    response = client.get("/api/dashboard/expirations?days=30", headers=auth_headers(token))

    assert response.status_code == 200
    assert {item["employee_id"] for item in response.json()["items"]} == {direct.id, indirect.id}


def test_none_scope_blocks_expirations(client, db_session):
    employee = make_employee(
        db_session,
        tms_id="NONE",
        full_name="Nessun Accesso",
        config_expirations_scope="none",
        config_can_access_expirations=False,
    )
    token = make_linked_user_token(db_session, employee, username="none")

    response = client.get("/api/dashboard/expirations?days=30", headers=auth_headers(token))

    assert response.status_code == 403


def test_admin_impersonation_uses_impersonated_reports_scope(client, db_session, monkeypatch):
    manager = make_employee(
        db_session,
        tms_id="VIEW-MGR",
        full_name="Manager Impersonato",
        config_expirations_scope="reports",
        config_can_access_expirations=True,
    )
    report = make_employee(
        db_session,
        tms_id="VIEW-REPORT",
        full_name="Riporto Visibile",
        manager_employee_id=manager.id,
    )
    outsider = make_employee(db_session, tms_id="VIEW-OUT", full_name="Esterno Non Visibile")
    token = make_admin_token(db_session)
    by_code = {
        employee.tms_id: _expiration(employee)
        for employee in (manager, report, outsider)
    }
    monkeypatch.setattr("app.api.dashboard._get_expirations_by_code", lambda _db: by_code)

    response = client.get(
        "/api/dashboard/expirations?days=30",
        headers={**auth_headers(token), "X-Impersonate-Employee": manager.id},
    )

    assert response.status_code == 200
    assert {item["employee_id"] for item in response.json()["items"]} == {report.id}


def test_configuration_endpoint_saves_reports_scope(client, db_session):
    employee = make_employee(db_session, tms_id="CFG", full_name="Configurabile")
    token = make_admin_token(db_session)

    response = client.patch(
        f"/api/employees/{employee.id}/configuration-permissions",
        headers=auth_headers(token),
        json={
            "config_can_access_planning": False,
            "config_can_access_organization": False,
            "config_can_access_timesheets": False,
            "config_can_access_workloads": True,
            "config_can_access_expirations": True,
            "config_expirations_scope": "reports",
            "config_can_access_deliveries": False,
        },
    )

    assert response.status_code == 200
    assert response.json()["config_expirations_scope"] == "reports"
    assert response.json()["config_can_access_expirations"] is True

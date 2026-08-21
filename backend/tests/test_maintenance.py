from app.models import AuditLog
from tests.conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def test_questionnaire_requires_maintenance_permission(client, db_session):
    employee = make_employee(
        db_session,
        tms_id="maintenance-denied",
        full_name="Utente senza manutenzioni",
        config_can_access_maintenance=False,
    )
    token = make_linked_user_token(db_session, employee, username="maintenance-denied")

    response = client.get("/api/maintenance/questionnaire", headers=auth_headers(token))

    assert response.status_code == 403
    assert response.json()["detail"] == "Accesso manutenzioni non consentito."


def test_enabled_employee_can_read_empty_questionnaire(client, db_session):
    employee = make_employee(
        db_session,
        tms_id="maintenance-reader",
        full_name="Utente manutenzioni",
        config_can_access_maintenance=True,
    )
    token = make_linked_user_token(db_session, employee, username="maintenance-reader")

    me = client.get("/api/auth/me", headers=auth_headers(token))
    response = client.get("/api/maintenance/questionnaire", headers=auth_headers(token))

    assert me.status_code == 200
    assert me.json()["can_access_maintenance"] is True
    assert response.status_code == 200
    assert response.json() == {
        "answers": {},
        "version": 0,
        "updated_at": None,
        "updated_by": None,
    }


def test_admin_can_save_shared_questionnaire_with_audit(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)

    saved = client.put(
        "/api/maintenance/questionnaire",
        headers=headers,
        json={"version": 0, "answers": {"1.1": "Le scadenze sono su più file.", "2.1": ["Carrelli elevatori"]}},
    )

    assert saved.status_code == 200
    assert saved.json()["version"] == 1
    assert saved.json()["answers"]["1.1"] == "Le scadenze sono su più file."
    assert saved.json()["updated_by"] == "Sys Admin"

    reread = client.get("/api/maintenance/questionnaire", headers=headers)
    assert reread.status_code == 200
    assert reread.json()["answers"] == saved.json()["answers"]

    audit = db_session.query(AuditLog).filter(AuditLog.entity == "maintenance_questionnaire").one()
    assert audit.action == "update"
    assert audit.detail["version"] == 1
    assert audit.detail["answered_fields"] == 2


def test_questionnaire_rejects_stale_version(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    first = client.put(
        "/api/maintenance/questionnaire",
        headers=headers,
        json={"version": 0, "answers": {"1.1": "Prima versione"}},
    )
    assert first.status_code == 200

    stale = client.put(
        "/api/maintenance/questionnaire",
        headers=headers,
        json={"version": 0, "answers": {"1.1": "Versione obsoleta"}},
    )

    assert stale.status_code == 400
    assert "aggiornato da un altro utente" in stale.json()["detail"]


def test_admin_can_enable_maintenance_permission(client, db_session):
    employee = make_employee(
        db_session,
        tms_id="maintenance-toggle",
        full_name="Utente da abilitare",
        config_can_access_maintenance=False,
    )
    admin_token = make_admin_token(db_session)

    response = client.patch(
        f"/api/employees/{employee.id}/configuration-permissions",
        headers=auth_headers(admin_token),
        json={
            "config_can_access_planning": False,
            "config_can_access_organization": False,
            "config_can_access_timesheets": False,
            "config_can_access_workloads": True,
            "config_can_access_expirations": True,
            "config_expirations_scope": "all",
            "config_can_access_deliveries": False,
            "config_can_access_maintenance": True,
        },
    )

    assert response.status_code == 200
    assert response.json()["config_can_access_maintenance"] is True
    db_session.refresh(employee)
    assert employee.config_can_access_maintenance is True

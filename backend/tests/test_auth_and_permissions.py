from app.enums import UserRole
from app.models import User
from app.services.absence_permissions import build_absence_permission_context
from tests.conftest import auth_headers, make_employee, make_linked_user_token, make_admin_token


def test_protected_endpoint_requires_token(client, db_session):
    response = client.get("/api/employees")
    assert response.status_code == 401


def test_collaborator_cannot_list_employees(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    token = make_linked_user_token(db_session, employee, username="mrossi")
    response = client.get("/api/employees", headers=auth_headers(token))
    assert response.status_code == 403


def test_admin_can_list_employees(client, db_session):
    make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    token = make_admin_token(db_session)
    response = client.get("/api/employees", headers=auth_headers(token))
    assert response.status_code == 200
    assert any(item["tms_id"] == "100" for item in response.json())


def test_linked_employee_role_overrides_legacy_admin_account(client, db_session):
    manager = make_employee(
        db_session,
        tms_id="116",
        full_name="Manager Storico",
        app_role=None,
        config_can_access_organization=False,
        config_can_access_timesheets=False,
        config_can_access_workloads=False,
        config_expirations_scope="none",
        config_can_access_deliveries=False,
    )
    make_employee(
        db_session,
        tms_id="117",
        full_name="Riporto Diretto",
        manager_employee_id=manager.id,
    )
    token = make_linked_user_token(
        db_session,
        manager,
        username="legacy-admin-manager",
        role=UserRole.admin,
    )

    response = client.get("/api/auth/me", headers=auth_headers(token))
    assert response.status_code == 200
    payload = response.json()
    assert payload["role"] == "ADMIN"
    assert payload["effective_role"] == "manager"
    assert payload["is_manager"] is True
    assert payload["can_access_organization"] is False
    assert payload["can_access_timesheets"] is False
    assert payload["can_access_workloads"] is False
    assert payload["expirations_scope"] == "none"
    assert payload["can_access_deliveries"] is False
    assert payload["can_access_maintenance"] is False

    admin_only = client.get("/api/audit-logs", headers=auth_headers(token))
    assert admin_only.status_code == 403

    user = db_session.query(User).filter(User.username == "legacy-admin-manager").one()
    absence_context = build_absence_permission_context(db_session, user)
    assert absence_context.is_admin is False


def test_linked_employee_app_role_can_grant_admin(client, db_session):
    employee = make_employee(
        db_session,
        tms_id="118",
        full_name="Admin Applicativo",
        app_role="ADMIN",
    )
    token = make_linked_user_token(db_session, employee, username="app-admin")

    response = client.get("/api/auth/me", headers=auth_headers(token))
    assert response.status_code == 200
    assert response.json()["role"] == "PLANNER"
    assert response.json()["effective_role"] == "admin"

    admin_only = client.get("/api/audit-logs", headers=auth_headers(token))
    assert admin_only.status_code == 200


def test_dashboard_me_blocks_other_employees(client, db_session):
    me = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    other = make_employee(db_session, tms_id="101", full_name="Luigi Verdi")
    token = make_linked_user_token(db_session, me, username="mrossi")

    own = client.get(
        f"/api/dashboard/me?employee_id={me.id}&date=2026-07-03",
        headers=auth_headers(token),
    )
    assert own.status_code == 200

    foreign = client.get(
        f"/api/dashboard/me?employee_id={other.id}&date=2026-07-03",
        headers=auth_headers(token),
    )
    assert foreign.status_code == 403


def test_dashboard_me_allows_admin_for_anyone(client, db_session):
    other = make_employee(db_session, tms_id="101", full_name="Luigi Verdi")
    token = make_admin_token(db_session)
    response = client.get(
        f"/api/dashboard/me?employee_id={other.id}&date=2026-07-03",
        headers=auth_headers(token),
    )
    assert response.status_code == 200


def test_active_activities_admin_requires_timesheets_access(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    token = make_linked_user_token(db_session, employee, username="mrossi")
    response = client.get("/api/activity-records/active/admin", headers=auth_headers(token))
    assert response.status_code == 403


def test_login_rate_limit_after_failures(client, db_session):
    payload = {"username": "utente.inesistente", "password": "sbagliata"}
    for _ in range(5):
        response = client.post("/api/auth/login", json=payload)
        assert response.status_code == 401
    blocked = client.post("/api/auth/login", json=payload)
    assert blocked.status_code == 429


def test_portal_login_and_refresh(client, db_session):
    login = client.post("/api/auth/login", json={"username": "admin", "password": "admin"})
    assert login.status_code == 200
    token = login.json()["access_token"]

    refreshed = client.post("/api/auth/refresh", headers=auth_headers(token))
    assert refreshed.status_code == 200
    assert refreshed.json()["access_token"]
    assert refreshed.json()["user"]["can_access_maintenance"] is False

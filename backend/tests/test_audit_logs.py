from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.models import AuditLog
from app.services.local_user_auth import hash_local_user_password
from tests.conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def test_team_create_is_audited_with_actor(client, db_session):
    token = make_admin_token(db_session)
    response = client.post(
        "/api/teams",
        json={"name": "Squadra Test", "icon": "🚚", "color": "#007040"},
        headers=auth_headers(token),
    )
    assert response.status_code == 201

    log = db_session.scalar(
        select(AuditLog).where(AuditLog.entity == "team", AuditLog.action == "create")
    )
    assert log is not None
    assert log.actor_name == "sysadmin"
    assert log.user_id is not None
    assert log.detail["name"] == "Squadra Test"
    assert log.created_at is not None


def test_operational_area_update_records_real_actor(client, db_session):
    token = make_admin_token(db_session)
    created = client.post(
        "/api/operational-areas",
        json={"area_code": "TEST", "name": "Test Area"},
        headers=auth_headers(token),
    )
    assert created.status_code == 201

    updated = client.put(
        f"/api/operational-areas/{created.json()['id']}",
        json={"description": "aggiornata"},
        headers=auth_headers(token),
    )
    assert updated.status_code == 200

    logs = db_session.scalars(
        select(AuditLog).where(AuditLog.entity == "operational_area")
    ).all()
    assert {log.action for log in logs} == {"create", "update"}
    assert all(log.actor_name == "sysadmin" for log in logs)


def test_local_user_login_is_audited(client, db_session):
    make_employee(
        db_session,
        tms_id="100",
        full_name="Mario Rossi",
        local_user_username="mrossi",
        local_user_password_hash=hash_local_user_password("Segreta123"),
        local_user_password_expires_at=datetime.now(timezone.utc) + timedelta(days=30),
    )
    db_session.commit()

    response = client.post(
        "/api/auth/local-user/login",
        json={"username": "mrossi", "password": "Segreta123"},
    )
    assert response.status_code == 200

    log = db_session.scalar(
        select(AuditLog).where(AuditLog.entity == "auth", AuditLog.action == "login")
    )
    assert log is not None
    assert log.actor_name == "Mario Rossi"
    assert log.detail["provider"] == "local_user"


def test_audit_log_listing_requires_admin(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    token = make_linked_user_token(db_session, employee, username="mrossi")
    response = client.get("/api/audit-logs", headers=auth_headers(token))
    assert response.status_code == 403


def test_audit_log_listing_and_filters(client, db_session):
    token = make_admin_token(db_session)
    client.post(
        "/api/teams",
        json={"name": "Squadra Audit", "icon": "🚚", "color": "#007040"},
        headers=auth_headers(token),
    )

    listing = client.get("/api/audit-logs?entity=team", headers=auth_headers(token))
    assert listing.status_code == 200
    body = listing.json()
    assert body["total"] >= 1
    assert all(item["entity"] == "team" for item in body["items"])
    assert body["items"][0]["actor_name"] == "sysadmin"

    filters = client.get("/api/audit-logs/filters", headers=auth_headers(token))
    assert filters.status_code == 200
    assert "team" in filters.json()["entities"]

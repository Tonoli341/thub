from datetime import datetime, timedelta, timezone

from app.services.local_user_auth import (
    build_local_user_password_expiration,
    hash_local_user_password,
    is_local_user_password_expired,
    verify_local_user_password,
)
from tests.conftest import make_employee


def test_password_hash_roundtrip():
    stored = hash_local_user_password("Segreta123")
    assert verify_local_user_password("Segreta123", stored)
    assert not verify_local_user_password("Sbagliata", stored)
    assert not verify_local_user_password("Segreta123", None)
    assert not verify_local_user_password("Segreta123", "formato-non-valido")


def test_password_expiration():
    now = datetime.now(timezone.utc)
    assert is_local_user_password_expired(None)
    assert is_local_user_password_expired(now - timedelta(minutes=1))
    assert not is_local_user_password_expired(build_local_user_password_expiration(now))


def test_local_user_login_with_expired_password(client, db_session):
    make_employee(
        db_session,
        tms_id="100",
        full_name="Mario Rossi",
        local_user_username="mrossi",
        local_user_password_hash=hash_local_user_password("Segreta123"),
        local_user_password_expires_at=datetime.now(timezone.utc) - timedelta(days=1),
    )
    db_session.commit()

    response = client.post(
        "/api/auth/local-user/login",
        json={"username": "mrossi", "password": "Segreta123"},
    )
    assert response.status_code == 403
    assert "scaduta" in response.json()["detail"].lower()


def test_local_user_login_success(client, db_session):
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
    body = response.json()
    assert body["access_token"]
    assert body["employee"]["tms_id"] == "100"

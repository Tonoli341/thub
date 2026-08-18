from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import string
from datetime import datetime, timedelta, timezone


LOCAL_USER_PASSWORD_VALIDITY_DAYS = 90
_SCRYPT_N = 2**14
_SCRYPT_R = 8
_SCRYPT_P = 1


def generate_local_user_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits
    return "".join(secrets.choice(alphabet) for _ in range(length))


def hash_local_user_password(password: str) -> str:
    salt = os.urandom(16)
    derived_key = hashlib.scrypt(
        password.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
    )
    return f"scrypt${_SCRYPT_N}${_SCRYPT_R}${_SCRYPT_P}${base64.b64encode(salt).decode()}${base64.b64encode(derived_key).decode()}"


def verify_local_user_password(password: str, stored_hash: str | None) -> bool:
    if not stored_hash:
        return False
    try:
        algorithm, n_value, r_value, p_value, salt_b64, key_b64 = stored_hash.split("$", 5)
        if algorithm != "scrypt":
            return False
        salt = base64.b64decode(salt_b64.encode())
        expected_key = base64.b64decode(key_b64.encode())
        candidate_key = hashlib.scrypt(
            password.encode("utf-8"),
            salt=salt,
            n=int(n_value),
            r=int(r_value),
            p=int(p_value),
        )
    except Exception:
        return False
    return hmac.compare_digest(candidate_key, expected_key)


def build_local_user_password_expiration(now: datetime | None = None) -> datetime:
    current = now or datetime.now(timezone.utc)
    return current + timedelta(days=LOCAL_USER_PASSWORD_VALIDITY_DAYS)


def is_local_user_password_expired(expires_at: datetime | None, now: datetime | None = None) -> bool:
    if expires_at is None:
        return True
    if expires_at.tzinfo is None:
        # valori naive (es. driver che non riportano il fuso): assunti UTC
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    current = now or datetime.now(timezone.utc)
    return expires_at <= current

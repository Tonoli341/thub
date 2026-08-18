from datetime import datetime, timedelta, timezone

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import User

bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(*, subject: str, role: str, token_type: str = "access") -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.jwt_expire_minutes)
    payload = {
        "sub": subject,
        "role": role,
        "token_type": token_type,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_access_token(token: str) -> dict:
    try:
        return jwt.decode(token, settings.jwt_secret_key, algorithms=[settings.jwt_algorithm])
    except jwt.InvalidTokenError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido.") from exc


def create_email_approval_token(*, justification_id: str, approver_employee_id: str) -> str:
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.email_approval_token_expire_minutes)
    payload = {
        "token_type": "email_approval",
        "justification_id": justification_id,
        "approver_employee_id": approver_employee_id,
        "exp": expires_at,
    }
    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_email_approval_token(token: str) -> dict:
    payload = decode_access_token(token)
    if payload.get("token_type") != "email_approval":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido.")
    justification_id = str(payload.get("justification_id") or "").strip()
    approver_employee_id = str(payload.get("approver_employee_id") or "").strip()
    if not justification_id or not approver_employee_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido.")
    return payload


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticazione richiesta.")

    payload = decode_access_token(credentials.credentials)
    username = str(payload.get("sub") or "").strip()
    if not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido.")

    user = db.scalars(select(User).where(func.lower(User.username) == username.lower())).first()
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utente non autorizzato.")

    return user

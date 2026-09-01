import hmac
from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload

from app.db import get_db
from app.models import Employee, User
from app.config import settings
from app.services.portal_auth import build_auth_user_read
from app.services.security import bearer_scheme, decode_access_token, get_current_user


async def get_impersonation_employee(
    x_impersonate_employee: Annotated[str | None, Header()] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Employee | None:
    if not x_impersonate_employee:
        return None
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Solo gli admin possono usare l'impersonificazione.",
        )
    employee = db.get(Employee, x_impersonate_employee)
    if employee is None or not employee.is_active:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Dipendente da impersonare non trovato.",
        )
    return employee


def require_admin(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso riservato agli amministratori.")
    return current_user


def require_admin_or_hr(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role not in ("admin", "hr"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso riservato ad admin e HR.")
    return current_user


def require_organization_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if not auth.can_access_organization:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso organizzazione non consentito.")
    return current_user


def require_organization_or_planner_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if not (auth.can_access_organization or auth.can_access_planning):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso non consentito.")
    return current_user


def require_deliveries_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if not auth.can_access_deliveries:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso consegne non consentito.")
    return current_user


def require_timesheets_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if not auth.can_access_timesheets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso rendicontazioni non consentito.")
    return current_user


def require_maintenance_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if not auth.can_access_maintenance:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso manutenzioni non consentito.")
    return current_user


def require_manager_or_above(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role not in ("admin", "hr", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso riservato ai responsabili.")
    return current_user


def require_deliveries_tablet_access(
    x_tablet_key: Annotated[str | None, Header()] = None,
) -> str:
    configured_key = settings.deliveries_tablet_api_key.strip()
    if not configured_key:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Accesso tablet consegne non configurato.",
        )
    provided_key = (x_tablet_key or "").strip()
    if not provided_key or not hmac.compare_digest(provided_key.encode("utf-8"), configured_key.encode("utf-8")):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Tablet non autorizzato.")
    return settings.deliveries_tablet_label.strip() or "tablet-consegne"


def deliveries_tablet_label() -> str:
    return settings.deliveries_tablet_label.strip() or "tablet-consegne"


def require_organization_access_or_tablet(
    x_tablet_key: Annotated[str | None, Header()] = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Autorizza gli endpoint usati anche dall'app mobile Consegne: header
    X-Tablet-Key (dispositivo esterno, nessun utente -> ritorna None) oppure
    login utente da portale con accesso organizzazione (ritorna lo User)."""
    configured_key = settings.deliveries_tablet_api_key.strip()
    provided_key = (x_tablet_key or "").strip()
    if configured_key and provided_key and hmac.compare_digest(provided_key.encode("utf-8"), configured_key.encode("utf-8")):
        return None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        current_user = get_current_user(credentials=credentials, db=db)
        auth = build_auth_user_read(db, current_user)
        if not auth.can_access_organization:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso organizzazione non consentito.")
        return current_user
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticazione richiesta.")


def require_deliveries_access_or_tablet(
    x_tablet_key: Annotated[str | None, Header()] = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Come require_organization_access_or_tablet ma per la sezione Consegne:
    header X-Tablet-Key (nessun utente -> ritorna None) oppure utente portale
    con permesso consegne (ritorna lo User)."""
    configured_key = settings.deliveries_tablet_api_key.strip()
    provided_key = (x_tablet_key or "").strip()
    if configured_key and provided_key and hmac.compare_digest(provided_key.encode("utf-8"), configured_key.encode("utf-8")):
        return None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        current_user = get_current_user(credentials=credentials, db=db)
        auth = build_auth_user_read(db, current_user)
        if not auth.can_access_deliveries:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso consegne non consentito.")
        return current_user
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticazione richiesta.")


def require_authenticated_or_tablet(
    x_tablet_key: Annotated[str | None, Header()] = None,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User | None:
    """Lettura risorse condivise del flusso Consegne (es. la policy da leggere
    prima della firma): header X-Tablet-Key (ritorna None) oppure un qualunque
    utente autenticato, anche senza permesso consegne (il dipendente che firma
    via web deve poter leggere la policy)."""
    configured_key = settings.deliveries_tablet_api_key.strip()
    provided_key = (x_tablet_key or "").strip()
    if configured_key and provided_key and hmac.compare_digest(provided_key.encode("utf-8"), configured_key.encode("utf-8")):
        return None
    if credentials is not None and credentials.scheme.lower() == "bearer":
        return get_current_user(credentials=credentials, db=db)
    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticazione richiesta.")


def get_current_local_employee(
    credentials=Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Employee:
    if credentials is None or credentials.scheme.lower() != "bearer":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Autenticazione richiesta.")

    payload = decode_access_token(credentials.credentials)
    token_type = str(payload.get("token_type") or "").strip().lower()
    username = str(payload.get("sub") or "").strip()
    if token_type != "local_user" or not username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token non valido.")

    employee = db.scalar(
        select(Employee)
        .where(func.lower(Employee.local_user_username) == username.lower())
        .options(selectinload(Employee.default_operational_area))
    )
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utente non autorizzato.")
    return employee

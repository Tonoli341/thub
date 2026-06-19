from typing import Annotated

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.enums import UserRole
from app.models import Employee, User
from app.services.portal_auth import build_auth_user_read
from app.services.security import get_current_user


async def get_impersonation_employee(
    x_impersonate_employee: Annotated[str | None, Header()] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Employee | None:
    if not x_impersonate_employee:
        return None
    if current_user.role != UserRole.admin:
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


def require_manager_or_above(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role not in ("admin", "hr", "manager"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso riservato ai responsabili.")
    return current_user

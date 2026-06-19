from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.enums import UserRole
from app.models import Employee, User
from app.schemas import AuthLoginRequest, AuthUserRead, TokenResponse
from app.services.ldap_auth import authenticate_with_ldap
from app.services.portal_auth import authenticate_with_env_credentials, build_auth_user_read, build_impersonation_view
from app.services.security import get_current_user

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: AuthLoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    env_response = authenticate_with_env_credentials(payload, request, db)
    if env_response is not None:
        return env_response
    return authenticate_with_ldap(payload, request, db)


@router.get("/me", response_model=AuthUserRead)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AuthUserRead:
    return build_auth_user_read(db, current_user)


@router.get("/impersonate/{employee_id}", response_model=AuthUserRead)
def impersonate(
    employee_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AuthUserRead:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono usare l'impersonificazione.")
    employee = db.get(Employee, employee_id)
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato.")
    return build_impersonation_view(db, employee)

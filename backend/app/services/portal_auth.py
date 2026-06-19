from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import AppRole, UserRole
from app.models import Employee, User
from app.schemas import AuthLoginRequest, AuthUserRead, TokenResponse
from app.services.absence_permissions import get_linked_tms_employee
from app.services.audit import record_audit_log
from app.services.security import create_access_token


PORTAL_DISPLAY_NAME = "Portale Rendicontazioni"


def is_portal_user(user: User) -> bool:
    return bool(settings.app_username.strip()) and user.username.lower() == settings.app_username.strip().lower()


def _compute_effective_role(db: Session, linked_employee: Employee | None, is_system_admin: bool) -> tuple[str, bool]:
    """Return (effective_role, is_manager)."""
    if is_system_admin:
        return "admin", False

    if linked_employee is None:
        return "collaboratore", False

    app_role = (linked_employee.app_role or "").upper()
    if app_role == AppRole.admin.value:
        return "admin", False
    if app_role == AppRole.hr.value:
        return "hr", False

    report_count = db.scalar(
        select(func.count(Employee.id)).where(
            Employee.manager_employee_id == linked_employee.id,
            Employee.is_active.is_(True),
        )
    ) or 0
    is_manager = report_count > 0
    return ("manager" if is_manager else "collaboratore"), is_manager


def _build_permission_fields(
    db: Session,
    employee: Employee | None,
    effective_role: str,
    is_manager: bool,
    is_portal: bool = False,
) -> dict:
    """Compute all permission-related fields for an AuthUserRead."""
    is_admin_or_hr = effective_role in ("admin", "hr")
    is_manager_or_above = effective_role in ("admin", "hr", "manager")

    if is_portal:
        can_access_timesheets = True
        can_access_planning = False
        can_access_calendar = False
        can_access_organization = False
        timesheets_scope = "all"
    else:
        can_access_timesheets = is_manager_or_above
        can_access_planning = is_manager_or_above
        can_access_calendar = True
        can_access_organization = is_admin_or_hr
        timesheets_scope = "all" if is_admin_or_hr else "team"

    planner_scope = (employee.planner_scope or "self") if employee else "all"

    if employee is None:
        absence_scope = "all"
    elif employee.absence_can_request_for_all:
        absence_scope = "all"
    elif employee.absence_can_request_for_reports:
        absence_scope = "team"
    else:
        absence_scope = "self"

    return dict(
        effective_role=effective_role,
        is_manager=is_manager,
        can_access_planning=can_access_planning,
        can_access_calendar=can_access_calendar,
        can_access_organization=can_access_organization,
        can_access_timesheets=can_access_timesheets,
        timesheets_scope=timesheets_scope,
        planner_scope=planner_scope,
        absence_scope=absence_scope,
    )


def build_auth_user_read(db: Session, user: User) -> AuthUserRead:
    linked_employee = get_linked_tms_employee(db, user)
    portal_user = is_portal_user(user)
    is_system_admin = portal_user or user.role == UserRole.admin

    effective_role, is_manager = _compute_effective_role(db, linked_employee, is_system_admin)
    perms = _build_permission_fields(db, linked_employee, effective_role, is_manager, is_portal=portal_user)

    return AuthUserRead(
        id=user.id,
        username=user.username,
        display_name=user.display_name,
        role=user.role,
        linked_employee_id=linked_employee.id if linked_employee else None,
        linked_employee_name=linked_employee.full_name if linked_employee else None,
        is_active=user.is_active,
        created_at=user.created_at,
        updated_at=user.updated_at,
        **perms,
    )


def build_impersonation_view(db: Session, employee: Employee) -> AuthUserRead:
    """Compute the AuthUserRead a given employee would have if they logged in."""
    effective_role, is_manager = _compute_effective_role(db, employee, is_system_admin=False)
    perms = _build_permission_fields(db, employee, effective_role, is_manager, is_portal=False)

    now = datetime.now(timezone.utc)
    return AuthUserRead(
        id=employee.id,
        username=employee.tms_id,
        display_name=employee.full_name,
        role=UserRole.manager,
        linked_employee_id=employee.id,
        linked_employee_name=employee.full_name,
        is_active=employee.is_active,
        created_at=now,
        updated_at=now,
        **perms,
    )


def ensure_portal_user(db: Session) -> User | None:
    username = settings.app_username.strip()
    if not username:
        return None

    user = db.scalars(select(User).where(func.lower(User.username) == username.lower())).first()
    if user is None:
        user = User(username=username, display_name=PORTAL_DISPLAY_NAME, role=UserRole.admin, is_active=True)
        db.add(user)
        db.flush()
    else:
        user.display_name = user.display_name or PORTAL_DISPLAY_NAME
        user.role = UserRole.admin
        user.is_active = True
    return user


def authenticate_with_env_credentials(data: AuthLoginRequest, request: Request, db: Session) -> TokenResponse | None:
    if not settings.portal_credentials_configured:
        return None

    username = data.username.strip()
    configured_username = settings.app_username.strip()
    if username.lower() != configured_username.lower():
        return None

    if data.password != settings.app_password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali non valide.")

    user = ensure_portal_user(db)
    if user is None or not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account non abilitato.")

    logged_at = datetime.now(timezone.utc)
    record_audit_log(
        db,
        action="login",
        entity="auth",
        actor_name=user.username,
        user_id=user.id,
        detail={
            "provider": "env",
            "logged_at": logged_at.isoformat(),
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        },
    )
    db.commit()
    db.refresh(user)

    return TokenResponse(
        access_token=create_access_token(subject=user.username, role=user.role.value),
        token_type="bearer",
        expires_in=settings.jwt_expire_minutes * 60,
        user=build_auth_user_read(db, user),
    )

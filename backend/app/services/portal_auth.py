import hmac
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
PLANNER_ACCESS_LEVELS = {
    "self_read",
    "team_read",
    "team_write",
    "all_read",
    "all_write",
}


def planner_level_can_write(level: str | None) -> bool:
    return level in {"team_write", "all_write"}


def planner_level_scope(level: str | None) -> str | None:
    if level == "self_read":
        return "self"
    if level in {"team_read", "team_write"}:
        return "team"
    if level in {"all_read", "all_write"}:
        return "all"
    return None


def resolve_planner_access_level(employee: Employee | None, effective_role: str, *, is_portal: bool = False) -> str | None:
    if is_portal:
        return None
    if effective_role == "admin":
        return "all_write"
    if employee is None:
        return None
    stored_level = employee.planner_access_level
    if stored_level in PLANNER_ACCESS_LEVELS:
        return stored_level
    if effective_role == "hr":
        return "all_read"
    if effective_role == "manager":
        return "team_read"
    return "self_read"


def is_portal_user(user: User) -> bool:
    return bool(settings.app_username.strip()) and user.username.lower() == settings.app_username.strip().lower()


def _compute_effective_role(
    db: Session,
    linked_employee: Employee | None,
    *,
    force_admin: bool = False,
    fallback_role: UserRole | None = None,
) -> tuple[str, bool]:
    """Return (effective_role, is_manager)."""
    if force_admin:
        return "admin", False

    if linked_employee is None:
        if fallback_role == UserRole.admin:
            return "admin", False
        if fallback_role == UserRole.manager:
            return "manager", True
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
    timesheets_enabled = bool(employee and employee.config_can_access_timesheets)
    organization_enabled = bool(employee and employee.config_can_access_organization)
    workloads_enabled = bool(employee is None or employee.config_can_access_workloads)
    if effective_role == "admin" or employee is None:
        expirations_scope = "all"
    else:
        stored_expirations_scope = employee.config_expirations_scope
        expirations_scope = stored_expirations_scope if stored_expirations_scope in {"none", "reports", "all"} else (
            "all" if employee.config_can_access_expirations else "none"
        )
    expirations_enabled = expirations_scope != "none"
    deliveries_enabled = bool(employee and employee.config_can_access_deliveries)
    maintenance_enabled = bool(employee and employee.config_can_access_maintenance)

    if is_portal:
        can_access_timesheets = True
        can_access_operational_reporting = False
        can_access_planning = False
        can_access_calendar = False
        can_access_organization = False
        can_access_workloads = False
        can_access_expirations = False
        can_access_deliveries = False
        can_access_maintenance = False
        timesheets_scope = "all"
    else:
        can_access_timesheets = effective_role == "admin" or (
            effective_role in ("hr", "manager") and timesheets_enabled
        )
        # Stesso criterio di services/operational_reporting.require_reporting_access:
        # ammette qualunque ruolo con la spunta attiva, non solo hr/manager, perché
        # l'accesso è poi limitato per squadra da Team.operational_reporting_owner_employee_id.
        can_access_operational_reporting = effective_role == "admin" or timesheets_enabled
        planner_access_level = resolve_planner_access_level(employee, effective_role, is_portal=is_portal)
        can_access_planning = planner_access_level is not None
        can_access_calendar = True
        can_access_organization = effective_role in ("admin", "hr") or (
            effective_role == "manager" and organization_enabled
        )
        can_access_workloads = effective_role == "admin" or workloads_enabled
        can_access_expirations = effective_role == "admin" or expirations_enabled
        can_access_deliveries = is_admin_or_hr or deliveries_enabled
        can_access_maintenance = effective_role == "admin" or maintenance_enabled
        timesheets_scope = "all" if is_admin_or_hr else "team"

    planner_access_level = resolve_planner_access_level(employee, effective_role, is_portal=is_portal)

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
        can_access_operational_reporting=can_access_operational_reporting,
        can_access_workloads=can_access_workloads,
        can_access_expirations=can_access_expirations,
        expirations_scope=expirations_scope,
        can_access_deliveries=can_access_deliveries,
        can_access_maintenance=can_access_maintenance,
        timesheets_scope=timesheets_scope,
        planner_access_level=planner_access_level,
        absence_scope=absence_scope,
        can_edit_absence_balances=(
            is_admin_or_hr
            and bool(employee and employee.absence_can_edit_balances)
        ),
    )


def build_auth_user_read(db: Session, user: User) -> AuthUserRead:
    linked_employee = get_linked_tms_employee(db, user)
    portal_user = is_portal_user(user)

    # Per gli account collegati a un dipendente, ruolo applicativo e gerarchia
    # del dipendente sono la fonte autorevole. users.role resta un fallback per
    # gli account senza collegamento; l'utenza tecnica del portale fa eccezione.
    effective_role, is_manager = _compute_effective_role(
        db,
        linked_employee,
        force_admin=portal_user,
        fallback_role=user.role,
    )
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
    effective_role, is_manager = _compute_effective_role(db, employee)
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

    if not hmac.compare_digest(data.password.encode("utf-8"), settings.app_password.encode("utf-8")):
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

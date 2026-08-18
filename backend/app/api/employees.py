import threading
import time
from datetime import date, datetime, timezone
from hashlib import sha1

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Response, status
from app.api.deps import (
    get_impersonation_employee,
    require_admin,
    require_admin_or_hr,
    require_organization_access,
    require_organization_access_or_tablet,
)
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Employee, OperationalArea, Team, User
from app.schemas import (
    EmployeeAbsencePermissionsUpdate,
    EmployeeCourseBadge,
    EmployeeExpirationRead,
    EmployeeConfigurationPermissionsUpdate,
    EmployeeDefaultAreaUpdate,
    EmployeeLocalUserUpdate,
    EmployeeManagerUpdate,
    EmployeeMobileRead,
    EmployeeOrganizationUpdate,
    EmployeeOptionRead,
    EmployeePhoneUpdate,
    EmployeeRead,
    EmployeeRoleUpdate,
    EmployeeScheduleUpdate,
    EmployeeSyncResult,
    PaginatedEmployeesMobile,
)
from app.services.hierarchy import collect_report_ids
from app.services.org import propagate_org_to_reports
from app.services.absence_permissions import DEFAULT_APPROVER_2_TMS_ID, DEFAULT_APPROVER_3_TMS_ID, build_absence_permission_context
from app.services.audit import record_audit_log
from app.services.local_user_auth import (
    build_local_user_password_expiration,
    hash_local_user_password,
    is_local_user_password_expired,
)
from app.services.normalization import normalize_phone
from app.services.security import get_current_user
from app.services.timeutils import today_local
from app.services.tms import (
    TmsEmployeeExpirationRecord,
    fetch_all_employee_expirations_from_tms,
    fetch_employee_expirations_from_tms,
    sync_employees,
)
from app.services.portal_auth import build_auth_user_read, build_impersonation_view, planner_level_scope

router = APIRouter(prefix="/employees", tags=["employees"])


def _can_include_local_user(db: Session, current_user: User) -> bool:
    return build_auth_user_read(db, current_user).effective_role == "admin"


def _has_active_reports(db: Session, employee_id: str) -> bool:
    report_count = db.scalar(
        select(func.count(Employee.id)).where(
            Employee.manager_employee_id == employee_id,
            Employee.is_active.is_(True),
        )
    ) or 0
    return report_count > 0


def _normalize_organization_access(
    employee: Employee,
    *,
    has_active_reports: bool,
    requested_enabled: bool,
) -> bool:
    app_role = (employee.app_role or "").upper()
    if app_role in {"ADMIN", "HR"}:
        return True
    if has_active_reports:
        return requested_enabled
    return False


def serialize_employee(employee: Employee, *, is_team_leader: bool = False, has_direct_reports: bool = False, include_local_user: bool = False) -> EmployeeRead:
    role_descriptions = [
        item.strip().upper()
        for item in (employee.absence_allowed_role_descriptions or "").split(",")
        if item.strip()
    ]
    effective_approver_1 = employee.absence_approver_1 or employee.manager
    effective_approver_2 = employee.absence_approver_2
    effective_approver_3 = employee.absence_approver_3
    return EmployeeRead(
        id=employee.id,
        tms_id=employee.tms_id,
        full_name=employee.full_name,
        first_name=employee.first_name,
        last_name=employee.last_name,
        phone=employee.phone,
        phone_from_tms=employee.phone_from_tms,
        tms_role_code=employee.tms_role_code,
        tms_role_description=employee.tms_role_description,
        contract_type=employee.contract_type,
        datore_lavoro=employee.datore_lavoro,
        organization_function=employee.organization_function,
        organization_department=employee.organization_department,
        organization_role=employee.organization_role,
        has_photo=employee.photo_jpeg is not None,
        default_site=employee.default_site,
        manager_name=employee.manager.full_name if employee.manager else employee.manager_name,
        manager_employee_id=employee.manager_employee_id,
        manager_employee_name=employee.manager.full_name if employee.manager else None,
        absence_can_request_for_self=employee.absence_can_request_for_self,
        absence_can_request_for_reports=employee.absence_can_request_for_reports,
        absence_can_request_for_all=employee.absence_can_request_for_all,
        absence_can_view_all=employee.absence_can_view_all,
        absence_can_edit_balances=employee.absence_can_edit_balances,
        absence_allowed_role_descriptions=role_descriptions,
        absence_requires_approval=employee.absence_requires_approval,
        absence_approver_1_employee_id=employee.absence_approver_1.id if employee.absence_approver_1 else None,
        absence_approver_1_employee_name=employee.absence_approver_1.full_name if employee.absence_approver_1 else None,
        absence_approver_2_employee_id=employee.absence_approver_2.id if employee.absence_approver_2 else None,
        absence_approver_2_employee_name=employee.absence_approver_2.full_name if employee.absence_approver_2 else f"TMS {DEFAULT_APPROVER_2_TMS_ID}",
        absence_approver_3_employee_id=employee.absence_approver_3.id if employee.absence_approver_3 else None,
        absence_approver_3_employee_name=employee.absence_approver_3.full_name if employee.absence_approver_3 else f"TMS {DEFAULT_APPROVER_3_TMS_ID}",
        config_can_access_planning=employee.config_can_access_planning,
        config_can_access_organization=employee.config_can_access_organization,
        config_can_access_timesheets=employee.config_can_access_timesheets,
        config_can_access_workloads=employee.config_can_access_workloads,
        config_can_access_expirations=employee.config_can_access_expirations,
        config_expirations_scope=employee.config_expirations_scope,
        config_can_access_deliveries=employee.config_can_access_deliveries,
        app_role=employee.app_role,
        planner_access_level=employee.planner_access_level,
        default_operational_area_id=employee.default_operational_area_id,
        default_operational_area_name=employee.default_operational_area.name if employee.default_operational_area else None,
        default_immobile=employee.default_immobile,
        default_schedule=employee.default_schedule,
        birth_date=employee.birth_date,
        local_user_username=employee.local_user_username if include_local_user else None,
        local_user_password_expires_at=employee.local_user_password_expires_at if include_local_user else None,
        local_user_password_updated_at=employee.local_user_password_updated_at if include_local_user else None,
        local_user_password_is_expired=is_local_user_password_expired(employee.local_user_password_expires_at) if include_local_user else True,
        is_active=employee.is_active,
        is_team_leader=is_team_leader,
        has_direct_reports=has_direct_reports,
        is_direttivo=employee.is_direttivo,
        created_at=employee.created_at,
        updated_at=employee.updated_at,
    )


def get_employee_with_relationships(db: Session, employee_id: str) -> Employee | None:
    return db.scalar(
        select(Employee)
        .where(Employee.id == employee_id)
        .options(
            selectinload(Employee.default_operational_area),
            selectinload(Employee.manager),
            selectinload(Employee.absence_approver_1),
            selectinload(Employee.absence_approver_2),
            selectinload(Employee.absence_approver_3),
        )
    )


def validate_manager_assignment(db: Session, employee: Employee, manager_employee_id: str | None) -> Employee | None:
    if manager_employee_id is None:
        return None
    if manager_employee_id == employee.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="An employee cannot be their own manager.")

    manager = db.scalar(select(Employee).where(Employee.id == manager_employee_id).options(selectinload(Employee.manager)))
    if manager is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Manager employee not found.")

    cursor = manager
    visited: set[str] = set()
    while cursor is not None:
        if cursor.id == employee.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Manager assignment would create a cycle.")
        if cursor.id in visited:
            break
        visited.add(cursor.id)
        cursor = db.scalar(select(Employee).where(Employee.id == cursor.manager_employee_id)) if cursor.manager_employee_id else None

    return manager


def _list_employees_mobile(
    db: Session,
    *,
    search: str | None,
    active_only: bool,
    page: int,
    size: int,
) -> PaginatedEmployeesMobile:
    statement: Select[tuple[Employee]] = select(Employee)
    if active_only:
        statement = statement.where(Employee.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                Employee.full_name.ilike(pattern),
                Employee.organization_role.ilike(pattern),
                Employee.organization_department.ilike(pattern),
                Employee.tms_role_description.ilike(pattern),
            )
        )
    statement = statement.order_by(Employee.full_name.asc())

    count_statement = select(func.count()).select_from(statement.order_by(None).subquery())
    total = db.scalar(count_statement) or 0

    employees = db.scalars(statement.offset((page - 1) * size).limit(size)).all()
    items = [
        EmployeeMobileRead(
            id=employee.id,
            full_name=employee.full_name,
            role=employee.organization_role or employee.tms_role_description,
            department=employee.organization_department,
            is_active=employee.is_active,
        )
        for employee in employees
    ]
    return PaginatedEmployeesMobile(items=items, total=total, page=page, size=size)


@router.get("")
def list_employees(
    search: str | None = Query(default=None),
    roles: list[str] | None = Query(default=None),
    active_only: bool = Query(default=True),
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
    auth_subject: User | None = Depends(require_organization_access_or_tablet),
) -> list[EmployeeRead] | PaginatedEmployeesMobile:
    if auth_subject is None:
        return _list_employees_mobile(db, search=search, active_only=active_only, page=page, size=size)
    current_user = auth_subject
    statement: Select[tuple[Employee]] = select(Employee).options(
        selectinload(Employee.default_operational_area),
        selectinload(Employee.manager),
        selectinload(Employee.absence_approver_1),
        selectinload(Employee.absence_approver_2),
        selectinload(Employee.absence_approver_3),
    )

    if active_only:
        statement = statement.where(Employee.is_active.is_(True))

    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                Employee.full_name.ilike(pattern),
                Employee.tms_id.ilike(pattern),
                Employee.datore_lavoro.ilike(pattern),
                Employee.organization_function.ilike(pattern),
                Employee.organization_department.ilike(pattern),
                Employee.organization_role.ilike(pattern),
                Employee.default_site.ilike(pattern),
                Employee.manager_name.ilike(pattern),
            )
        )

    if roles:
        normalized_roles = [role.strip().upper() for role in roles if role.strip()]
        if normalized_roles:
            statement = statement.where(Employee.tms_role_description.in_(normalized_roles))

    statement = statement.order_by(Employee.full_name.asc())
    employees = db.scalars(statement).all()
    team_leader_ids: set[str] = set(
        db.scalars(
            select(Team.team_leader_employee_id)
            .where(Team.team_leader_employee_id.is_not(None))
            .distinct()
        ).all()
    ) | set(
        db.scalars(
            select(Team.team_leader_2_employee_id)
            .where(Team.team_leader_2_employee_id.is_not(None))
            .distinct()
        ).all()
    )
    has_reports_ids: set[str] = set(
        db.scalars(
            select(Employee.manager_employee_id)
            .where(Employee.manager_employee_id.is_not(None))
            .where(Employee.is_active.is_(True))
            .distinct()
        ).all()
    )
    include_local_user = _can_include_local_user(db, current_user)
    return [serialize_employee(e, is_team_leader=e.id in team_leader_ids, has_direct_reports=e.id in has_reports_ids, include_local_user=include_local_user) for e in employees]


@router.get("/planner", response_model=list[EmployeeRead])
def list_planner_employees(
    search: str | None = Query(default=None),
    roles: list[str] | None = Query(default=None),
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> list[EmployeeRead]:
    auth = build_impersonation_view(db, impersonate_employee) if impersonate_employee is not None else build_auth_user_read(db, current_user)
    if not auth.can_access_planning:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso planner non consentito.")

    scope = planner_level_scope(auth.planner_access_level)
    linked_employee_id = auth.linked_employee_id
    allowed_employee_ids: set[str] | None = None
    if scope == "all":
        allowed_employee_ids = None
    elif scope == "team":
        if linked_employee_id is None:
            return []
        allowed_employee_ids = {linked_employee_id, *collect_report_ids(db, linked_employee_id)}
    else:
        if linked_employee_id is None:
            return []
        allowed_employee_ids = {linked_employee_id}

    statement: Select[tuple[Employee]] = select(Employee).options(
        selectinload(Employee.default_operational_area),
        selectinload(Employee.manager),
        selectinload(Employee.absence_approver_1),
        selectinload(Employee.absence_approver_2),
        selectinload(Employee.absence_approver_3),
    )
    if active_only:
        statement = statement.where(Employee.is_active.is_(True))
    if allowed_employee_ids is not None:
        statement = statement.where(Employee.id.in_(allowed_employee_ids))
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                Employee.full_name.ilike(pattern),
                Employee.tms_id.ilike(pattern),
                Employee.datore_lavoro.ilike(pattern),
                Employee.organization_function.ilike(pattern),
                Employee.organization_department.ilike(pattern),
                Employee.organization_role.ilike(pattern),
                Employee.default_site.ilike(pattern),
                Employee.manager_name.ilike(pattern),
            )
        )
    if roles:
        normalized_roles = [role.strip().upper() for role in roles if role.strip()]
        if normalized_roles:
            statement = statement.where(Employee.tms_role_description.in_(normalized_roles))

    statement = statement.order_by(Employee.full_name.asc())
    employees = db.scalars(statement).all()
    team_leader_ids: set[str] = set(
        db.scalars(select(Team.team_leader_employee_id).where(Team.team_leader_employee_id.is_not(None)).distinct()).all()
    ) | set(
        db.scalars(select(Team.team_leader_2_employee_id).where(Team.team_leader_2_employee_id.is_not(None)).distinct()).all()
    )
    has_reports_ids: set[str] = set(
        db.scalars(
            select(Employee.manager_employee_id)
            .where(Employee.manager_employee_id.is_not(None))
            .where(Employee.is_active.is_(True))
            .distinct()
        ).all()
    )
    return [serialize_employee(e, is_team_leader=e.id in team_leader_ids, has_direct_reports=e.id in has_reports_ids, include_local_user=False) for e in employees]


@router.get("/options", response_model=list[EmployeeOptionRead])
def list_employee_options(
    active_only: bool = Query(default=True),
    authorized_for_absence: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> list[EmployeeOptionRead]:
    statement: Select[tuple[Employee]] = select(Employee)

    if active_only:
        statement = statement.where(Employee.is_active.is_(True))

    if authorized_for_absence:
        context = build_absence_permission_context(db, current_user, impersonate_as=impersonate_employee)
        if not context.allowed_employee_ids:
            return []
        statement = statement.where(Employee.id.in_(context.allowed_employee_ids))

    statement = statement.order_by(Employee.full_name.asc())
    employees = db.scalars(statement).all()
    return [
        EmployeeOptionRead(
            id=employee.id,
            tms_id=employee.tms_id,
            full_name=employee.full_name,
            tms_role_code=employee.tms_role_code,
            tms_role_description=employee.tms_role_description,
            organization_function=employee.organization_function,
            organization_department=employee.organization_department,
        )
        for employee in employees
    ]


def _classify_course_badge(records: list[TmsEmployeeExpirationRecord]) -> dict[str, str]:
    today = today_local()
    antincendio = "missing"
    preposto = "missing"
    primo_soccorso = "missing"
    rls = "missing"
    rls_course_descriptions = {
        "rls",
    }

    for item in records:
        desc = (item.type_description or "").strip().lower()
        code_key = (item.type_code or "").strip().lower()
        exp = item.expiration_date

        if "antincendio" in desc or "antincendio" in code_key:
            antincendio = _expiration_status(exp, today)
        elif "preposto" in desc or "preposto" in code_key:
            preposto = _expiration_status(exp, today)
        elif "primo soccorso" in desc or "pronto soccorso" in desc or "primo-soccorso" in desc:
            primo_soccorso = _expiration_status(exp, today)
        elif desc in rls_course_descriptions or code_key in rls_course_descriptions:
            rls = _expiration_status(exp, today)

    return {
        "antincendio": antincendio,
        "preposto": preposto,
        "primo_soccorso": primo_soccorso,
        "rls": rls,
    }


def _expiration_status(exp: date | None, today: date) -> str:
    if exp is None:
        return "missing"
    diff = (exp - today).days
    if diff < 0:
        return "expired"
    if diff <= 30:
        return "expiring"
    return "valid"


# Cache in-memory dei badge corsi: le scadenze cambiano raramente, mentre la
# pagina Dipendenti/Organigramma le richiede a ogni apertura.
_COURSE_BADGES_TTL_SECONDS = 15 * 60
_course_badges_cache: dict = {"at": 0.0, "data": None}
_course_badges_lock = threading.Lock()


@router.get("/course-badges", response_model=list[EmployeeCourseBadge])
def get_course_badges(
    db: Session = Depends(get_db),
    _: User = Depends(require_organization_access),
) -> list[EmployeeCourseBadge]:
    now = time.monotonic()
    with _course_badges_lock:
        cached = _course_badges_cache["data"]
        if cached is not None and now - _course_badges_cache["at"] < _COURSE_BADGES_TTL_SECONDS:
            return cached

    employees = db.scalars(
        select(Employee).where(Employee.is_active.is_(True))
    ).all()

    try:
        expirations_by_code = fetch_all_employee_expirations_from_tms([emp.tms_id for emp in employees])
    except Exception:
        expirations_by_code = {}

    results: list[EmployeeCourseBadge] = []
    for emp in employees:
        badges = _classify_course_badge(expirations_by_code.get(emp.tms_id.strip(), []))
        results.append(EmployeeCourseBadge(
            employee_id=emp.id,
            antincendio=badges["antincendio"],
            preposto=badges["preposto"],
            primo_soccorso=badges["primo_soccorso"],
            rls=badges["rls"],
        ))

    with _course_badges_lock:
        _course_badges_cache["data"] = results
        _course_badges_cache["at"] = now

    return results


@router.get("/{employee_id}/expirations", response_model=list[EmployeeExpirationRead])
def get_employee_expirations(
    employee_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_organization_access),
) -> list[EmployeeExpirationRead]:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    return [
        EmployeeExpirationRead(
            code=item.code,
            type_code=item.type_code,
            type_description=item.type_description,
            expiration_date=item.expiration_date,
            issue_date=item.issue_date,
            issuing_authority=item.issuing_authority,
            document_number=item.document_number,
        )
        for item in fetch_employee_expirations_from_tms(employee.tms_id)
    ]


@router.get("/{employee_id}/photo")
def get_employee_photo(
    employee_id: str,
    db: Session = Depends(get_db),
    if_none_match: str | None = Header(default=None),
    _: User = Depends(get_current_user),
) -> Response:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    if not employee.photo_jpeg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee photo not found.")
    etag = f'"{sha1(employee.photo_jpeg).hexdigest()}"'
    cache_headers = {"Cache-Control": "private, max-age=86400", "ETag": etag}
    if if_none_match == etag:
        return Response(status_code=status.HTTP_304_NOT_MODIFIED, headers=cache_headers)
    return Response(content=employee.photo_jpeg, media_type="image/jpeg", headers=cache_headers)


@router.patch("/{employee_id}/manager", response_model=EmployeeRead)
def update_employee_manager(
    employee_id: str,
    payload: EmployeeManagerUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    previous_manager_employee_id = employee.manager_employee_id
    manager = validate_manager_assignment(db, employee, payload.manager_employee_id)
    employee.manager_employee_id = manager.id if manager else None
    employee.manager_name = manager.full_name if manager else None

    if manager:
        if not employee.organization_function and manager.organization_function:
            employee.organization_function = manager.organization_function
        if not employee.organization_department and manager.organization_department:
            employee.organization_department = manager.organization_department
    propagate_org_to_reports(db, employee)

    record_audit_log(
        db,
        action="update",
        entity="employee_manager",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "before": previous_manager_employee_id,
            "after": employee.manager_employee_id,
        },
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/absence-permissions", response_model=EmployeeRead)
def update_employee_absence_permissions(
    employee_id: str,
    payload: EmployeeAbsencePermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    def get_approver(approver_id: str | None) -> Employee | None:
        if not approver_id:
            return None
        if approver_id == employee.id:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Un dipendente non può essere approvatore di se stesso.")
        approver = db.get(Employee, approver_id)
        if approver is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Approver employee {approver_id} not found.")
        return approver

    approver_1 = get_approver(payload.absence_approver_1_employee_id)
    approver_2 = get_approver(payload.absence_approver_2_employee_id)
    approver_3 = get_approver(payload.absence_approver_3_employee_id)

    if payload.absence_can_edit_balances and (employee.app_role or "").upper() not in {"ADMIN", "HR"}:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="La modifica dei residui può essere abilitata solo per utenti Admin o HR.",
        )

    employee.absence_can_request_for_self = payload.absence_can_request_for_self
    employee.absence_can_request_for_reports = payload.absence_can_request_for_reports
    employee.absence_can_request_for_all = payload.absence_can_request_for_all
    employee.absence_can_view_all = payload.absence_can_view_all
    employee.absence_can_edit_balances = payload.absence_can_edit_balances
    employee.absence_allowed_role_descriptions = ",".join(sorted({item.strip().upper() for item in payload.absence_allowed_role_descriptions if item.strip()}))
    employee.absence_requires_approval = payload.absence_requires_approval
    employee.absence_approver_1_employee_id = approver_1.id if approver_1 else None
    employee.absence_approver_2_employee_id = approver_2.id if approver_2 else None
    employee.absence_approver_3_employee_id = approver_3.id if approver_3 else None

    record_audit_log(
        db,
        action="update",
        entity="employee_absence_permissions",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"employee_id": employee.id, "after": payload.model_dump(mode="json")},
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/configuration-permissions", response_model=EmployeeRead)
def update_employee_configuration_permissions(
    employee_id: str,
    payload: EmployeeConfigurationPermissionsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    has_active_reports = _has_active_reports(db, employee.id)
    employee.config_can_access_planning = payload.config_can_access_planning
    employee.config_can_access_organization = _normalize_organization_access(
        employee,
        has_active_reports=has_active_reports,
        requested_enabled=payload.config_can_access_organization,
    )
    employee.config_can_access_timesheets = payload.config_can_access_timesheets
    employee.config_can_access_workloads = payload.config_can_access_workloads
    expirations_scope = payload.config_expirations_scope
    if expirations_scope is None:
        expirations_scope = "all" if payload.config_can_access_expirations else "none"
    employee.config_expirations_scope = expirations_scope
    # Campo storico mantenuto sincronizzato per i client precedenti.
    employee.config_can_access_expirations = expirations_scope != "none"
    employee.config_can_access_deliveries = payload.config_can_access_deliveries

    record_audit_log(
        db,
        action="update",
        entity="employee_configuration_permissions",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"employee_id": employee.id, "after": payload.model_dump(mode="json")},
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee, has_direct_reports=has_active_reports, include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/app-role", response_model=EmployeeRead)
def update_employee_app_role(
    employee_id: str,
    payload: EmployeeRoleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    valid_roles = {"ADMIN", "HR", None}
    normalized_role = payload.app_role.strip().upper() if payload.app_role else None
    if normalized_role not in valid_roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"app_role non valido: {payload.app_role}")

    valid_levels = {"self_read", "team_read", "team_write", "all_read", "all_write", None}
    normalized_level = payload.planner_access_level.strip().lower() if payload.planner_access_level else None
    if normalized_level not in valid_levels:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"planner_access_level non valido: {payload.planner_access_level}")

    employee.app_role = normalized_role
    has_active_reports = _has_active_reports(db, employee.id)
    if normalized_role == "ADMIN":
        employee.planner_access_level = None
    else:
        employee.planner_access_level = normalized_level
    if normalized_role in {"ADMIN", "HR"}:
        employee.config_can_access_organization = True
    elif not has_active_reports:
        employee.config_can_access_organization = False
    if normalized_role not in {"ADMIN", "HR"}:
        employee.absence_can_edit_balances = False

    record_audit_log(
        db,
        action="update",
        entity="employee_app_role",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "app_role": normalized_role,
            "planner_access_level": employee.planner_access_level,
            "absence_can_edit_balances": employee.absence_can_edit_balances,
        },
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee, has_direct_reports=has_active_reports, include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/organization", response_model=EmployeeRead)
def update_employee_organization(
    employee_id: str,
    payload: EmployeeOrganizationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    employee.organization_role = (payload.organization_role or "").strip() or None
    if payload.organization_department is not None:
        employee.organization_department = payload.organization_department.strip() or None
    if payload.is_direttivo is not None:
        employee.is_direttivo = payload.is_direttivo

    propagate_org_to_reports(db, employee)

    record_audit_log(
        db,
        action="update",
        entity="employee_organization",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "organization_role": employee.organization_role,
            "organization_department": employee.organization_department,
        },
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))



@router.post("/sync", response_model=EmployeeSyncResult, status_code=status.HTTP_200_OK)
def manual_sync_employees(db: Session = Depends(get_db), _: User = Depends(require_admin)) -> EmployeeSyncResult:
    try:
        return sync_employees(db)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/{employee_id}/phone", response_model=EmployeeRead)
def update_employee_phone(
    employee_id: str,
    payload: EmployeePhoneUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    if employee.phone_from_tms:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Il numero di telefono proviene dall'integrazione SGA e non può essere modificato manualmente.")

    previous_phone = employee.phone
    employee.phone = normalize_phone(payload.phone)

    record_audit_log(
        db,
        action="update",
        entity="employee_phone",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "before": previous_phone,
            "after": employee.phone,
        },
    )
    db.commit()
    db.refresh(employee)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/default-area", response_model=EmployeeRead)
def update_employee_default_area(
    employee_id: str,
    payload: EmployeeDefaultAreaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    if payload.default_operational_area_id is None:
        employee.default_operational_area_id = None
    else:
        area = db.get(OperationalArea, payload.default_operational_area_id)
        if area is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operational area not found.")
        if not area.is_active:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Operational area is inactive.")
        employee.default_operational_area_id = area.id

    employee.default_immobile = (payload.default_immobile or "").strip().upper() or None

    record_audit_log(
        db,
        action="update",
        entity="employee_default_operational_area",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "default_operational_area_id": employee.default_operational_area_id,
            "default_immobile": employee.default_immobile,
        },
    )
    db.commit()
    db.refresh(employee)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/schedule", response_model=EmployeeRead)
def update_employee_schedule(
    employee_id: str,
    payload: EmployeeScheduleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    employee.default_schedule = [day.model_dump(mode="json") for day in payload.default_schedule]

    record_audit_log(
        db,
        action="update",
        entity="employee_schedule",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"employee_id": employee.id, "after": employee.default_schedule},
    )
    db.commit()
    db.refresh(employee)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))


@router.patch("/{employee_id}/local-user", response_model=EmployeeRead)
def update_employee_local_user(
    employee_id: str,
    payload: EmployeeLocalUserUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    normalized_username = payload.username.strip()
    if not normalized_username:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username obbligatorio.")

    existing = db.scalar(
        select(Employee).where(
            func.lower(Employee.local_user_username) == normalized_username.lower(),
            Employee.id != employee.id,
        )
    )
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Username già associato a un altro dipendente.")

    employee.local_user_username = normalized_username
    employee.local_user_password_hash = hash_local_user_password(payload.password)
    employee.local_user_password_updated_at = datetime.now(timezone.utc)
    employee.local_user_password_expires_at = build_local_user_password_expiration(employee.local_user_password_updated_at)

    record_audit_log(
        db,
        action="update",
        entity="employee_local_user",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "username": employee.local_user_username,
            "password_expires_at": employee.local_user_password_expires_at.isoformat() if employee.local_user_password_expires_at else None,
        },
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee, has_direct_reports=_has_active_reports(db, employee.id), include_local_user=_can_include_local_user(db, current_user))

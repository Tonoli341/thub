from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from app.api.deps import get_impersonation_employee, require_admin, require_admin_or_hr
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.models import Employee, OperationalArea, Team, User
from app.schemas import (
    EmployeeAbsencePermissionsUpdate,
    EmployeeExpirationRead,
    EmployeeConfigurationPermissionsUpdate,
    EmployeeDefaultAreaUpdate,
    EmployeeManagerUpdate,
    EmployeeOrganizationUpdate,
    EmployeeOptionRead,
    EmployeePhoneUpdate,
    EmployeeRead,
    EmployeeRoleUpdate,
    EmployeeScheduleUpdate,
    EmployeeSyncResult,
)
from app.services.org import propagate_org_to_reports
from app.services.absence_permissions import DEFAULT_APPROVER_2_TMS_ID, DEFAULT_APPROVER_3_TMS_ID, build_absence_permission_context
from app.services.audit import record_audit_log
from app.services.normalization import normalize_phone
from app.services.security import get_current_user
from app.services.tms import fetch_employee_expirations_from_tms, sync_employees

router = APIRouter(prefix="/employees", tags=["employees"])


def serialize_employee(employee: Employee, *, is_team_leader: bool = False) -> EmployeeRead:
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
        app_role=employee.app_role,
        planner_scope=employee.planner_scope or "self",
        default_operational_area_id=employee.default_operational_area_id,
        default_operational_area_name=employee.default_operational_area.name if employee.default_operational_area else None,
        default_immobile=employee.default_immobile,
        default_schedule=employee.default_schedule,
        is_active=employee.is_active,
        is_team_leader=is_team_leader,
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


@router.get("", response_model=list[EmployeeRead])
def list_employees(
    search: str | None = Query(default=None),
    roles: list[str] | None = Query(default=None),
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
) -> list[EmployeeRead]:
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
    return [serialize_employee(e, is_team_leader=e.id in team_leader_ids) for e in employees]


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

    statement = statement.order_by(Employee.full_name.asc())
    employees = db.scalars(statement).all()
    if authorized_for_absence:
        context = build_absence_permission_context(db, current_user, impersonate_as=impersonate_employee)
        employees = [employee for employee in employees if employee.id in context.allowed_employee_ids]
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


@router.get("/{employee_id}/expirations", response_model=list[EmployeeExpirationRead])
def get_employee_expirations(
    employee_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
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
def get_employee_photo(employee_id: str, db: Session = Depends(get_db)) -> Response:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    if not employee.photo_jpeg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee photo not found.")
    return Response(content=employee.photo_jpeg, media_type="image/jpeg")


@router.patch("/{employee_id}/manager", response_model=EmployeeRead)
def update_employee_manager(
    employee_id: str,
    payload: EmployeeManagerUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
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
        actor_name="system",
        detail={
            "employee_id": employee.id,
            "before": previous_manager_employee_id,
            "after": employee.manager_employee_id,
        },
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee)


@router.patch("/{employee_id}/absence-permissions", response_model=EmployeeRead)
def update_employee_absence_permissions(
    employee_id: str,
    payload: EmployeeAbsencePermissionsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
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

    employee.absence_can_request_for_self = payload.absence_can_request_for_self
    employee.absence_can_request_for_reports = payload.absence_can_request_for_reports
    employee.absence_can_request_for_all = payload.absence_can_request_for_all
    employee.absence_allowed_role_descriptions = ",".join(sorted({item.strip().upper() for item in payload.absence_allowed_role_descriptions if item.strip()}))
    employee.absence_requires_approval = payload.absence_requires_approval
    employee.absence_approver_1_employee_id = approver_1.id if approver_1 else None
    employee.absence_approver_2_employee_id = approver_2.id if approver_2 else None
    employee.absence_approver_3_employee_id = approver_3.id if approver_3 else None

    record_audit_log(
        db,
        action="update",
        entity="employee_absence_permissions",
        actor_name="system",
        detail={"employee_id": employee.id, "after": payload.model_dump(mode="json")},
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee)


@router.patch("/{employee_id}/configuration-permissions", response_model=EmployeeRead)
def update_employee_configuration_permissions(
    employee_id: str,
    payload: EmployeeConfigurationPermissionsUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    employee.config_can_access_planning = payload.config_can_access_planning
    employee.config_can_access_organization = payload.config_can_access_organization

    record_audit_log(
        db,
        action="update",
        entity="employee_configuration_permissions",
        actor_name="system",
        detail={"employee_id": employee.id, "after": payload.model_dump(mode="json")},
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee)


@router.patch("/{employee_id}/app-role", response_model=EmployeeRead)
def update_employee_app_role(
    employee_id: str,
    payload: EmployeeRoleUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    valid_roles = {"ADMIN", "HR", None}
    normalized_role = payload.app_role.strip().upper() if payload.app_role else None
    if normalized_role not in valid_roles:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"app_role non valido: {payload.app_role}")

    valid_scopes = {"self", "team", "all"}
    if payload.planner_scope not in valid_scopes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"planner_scope non valido: {payload.planner_scope}")

    employee.app_role = normalized_role
    employee.planner_scope = payload.planner_scope

    record_audit_log(
        db,
        action="update",
        entity="employee_app_role",
        actor_name="system",
        detail={"employee_id": employee.id, "app_role": normalized_role, "planner_scope": payload.planner_scope},
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee)


@router.patch("/{employee_id}/organization", response_model=EmployeeRead)
def update_employee_organization(
    employee_id: str,
    payload: EmployeeOrganizationUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    employee.organization_role = (payload.organization_role or "").strip() or None
    if payload.organization_department is not None:
        employee.organization_department = payload.organization_department.strip() or None

    propagate_org_to_reports(db, employee)

    record_audit_log(
        db,
        action="update",
        entity="employee_organization",
        actor_name="system",
        detail={
            "employee_id": employee.id,
            "organization_role": employee.organization_role,
            "organization_department": employee.organization_department,
        },
    )
    db.commit()
    db.refresh(employee)
    employee = get_employee_with_relationships(db, employee.id)
    return serialize_employee(employee)



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
    _: User = Depends(require_admin_or_hr),
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
        actor_name="system",
        detail={
            "employee_id": employee.id,
            "before": previous_phone,
            "after": employee.phone,
        },
    )
    db.commit()
    db.refresh(employee)
    return serialize_employee(employee)


@router.patch("/{employee_id}/default-area", response_model=EmployeeRead)
def update_employee_default_area(
    employee_id: str,
    payload: EmployeeDefaultAreaUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
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
        actor_name="system",
        detail={
            "employee_id": employee.id,
            "default_operational_area_id": employee.default_operational_area_id,
            "default_immobile": employee.default_immobile,
        },
    )
    db.commit()
    db.refresh(employee)
    return serialize_employee(employee)


@router.patch("/{employee_id}/schedule", response_model=EmployeeRead)
def update_employee_schedule(
    employee_id: str,
    payload: EmployeeScheduleUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
) -> EmployeeRead:
    employee = get_employee_with_relationships(db, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    employee.default_schedule = [day.model_dump(mode="json") for day in payload.default_schedule]

    record_audit_log(
        db,
        action="update",
        entity="employee_schedule",
        actor_name="system",
        detail={"employee_id": employee.id, "after": employee.default_schedule},
    )
    db.commit()
    db.refresh(employee)
    return serialize_employee(employee)

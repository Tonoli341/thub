from datetime import date, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.dashboard import build_personal_info
from app.api.deps import get_current_local_employee
from app.db import get_db
from app.models import Employee, InfinityBillingCustomerSupplierMap, InfinityMapFieldAssignment, OperationalArea, Team, TeamMember, User
from app.schemas import (
    AuthLoginRequest,
    AuthUserRead,
    EmployeeListItem,
    ExternalEmployeeRead,
    InfinityMapFieldAssignmentRead,
    LocalUserInfinityCrossMappingRow,
    LocalUserInfinityCrossMappingsResponse,
    LocalUserMyInfoResponse,
    LocalUserOperationalAreaOption,
    LocalUserTokenResponse,
    LocalUserTeam,
    LocalUserTeamMember,
    LocalUserValidationRequest,
    TokenResponse,
)
from app.config import settings
from app.services.audit import record_audit_log
from app.services.ldap_auth import authenticate_with_ldap, maybe_refresh_ldap_employee
from app.services.local_user_auth import is_local_user_password_expired, verify_local_user_password
from app.services.normalization import building_codes
from app.services.portal_auth import authenticate_with_env_credentials, build_auth_user_read, build_impersonation_view
from app.services.rate_limit import check_login_allowed, record_login_failure, reset_login_failures
from app.services.security import create_access_token, get_current_user
from app.services.timeutils import today_local

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=TokenResponse)
def login(payload: AuthLoginRequest, request: Request, db: Session = Depends(get_db)) -> TokenResponse:
    check_login_allowed(request, payload.username)
    try:
        env_response = authenticate_with_env_credentials(payload, request, db)
        if env_response is not None:
            reset_login_failures(request, payload.username)
            return env_response
        response = authenticate_with_ldap(payload, request, db)
    except HTTPException as exc:
        if exc.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
            record_login_failure(request, payload.username)
        raise
    reset_login_failures(request, payload.username)
    return response


@router.get("/me", response_model=AuthUserRead)
def me(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> AuthUserRead:
    return build_auth_user_read(db, current_user)


@router.post("/refresh", response_model=TokenResponse)
def refresh_token(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> TokenResponse:
    """Rinnova il token di un utente ancora autenticato (rolling session).

    Permette di tenere JWT_EXPIRE_MINUTES basso senza interrompere gli utenti
    attivi: il frontend chiama questo endpoint periodicamente.

    Ne approfittiamo anche per rinfrescare in background (throttlato) i dati LDAP
    dell'utente, così eventuali modifiche fatte su AD dopo il primo login si
    propagano senza dover attendere che l'utente reinserisca la password.
    """
    maybe_refresh_ldap_employee(current_user.ldap_employee)
    db.commit()
    return TokenResponse(
        access_token=create_access_token(subject=current_user.username, role=current_user.role.value),
        token_type="bearer",
        expires_in=settings.jwt_expire_minutes * 60,
        user=build_auth_user_read(db, current_user),
    )


def _authenticate_local_user_or_401(db: Session, payload: LocalUserValidationRequest) -> Employee:
    username = payload.username.strip()
    employee = db.scalar(
        select(Employee)
        .where(func.lower(Employee.local_user_username) == username.lower())
        .options(selectinload(Employee.default_operational_area))
    )
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utente o password non validi.")
    if not verify_local_user_password(payload.password, employee.local_user_password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Utente o password non validi.")
    if is_local_user_password_expired(employee.local_user_password_expires_at):
        expires_at = employee.local_user_password_expires_at.astimezone(timezone.utc).date().isoformat() if employee.local_user_password_expires_at else None
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=f"Password scaduta{f' il {expires_at}' if expires_at else ''}. Deve essere modificata.",
        )
    return employee


def _serialize_external_employee(employee: Employee) -> ExternalEmployeeRead:
    return ExternalEmployeeRead(
        id=employee.id,
        tms_id=employee.tms_id,
        full_name=employee.full_name,
        first_name=employee.first_name,
        last_name=employee.last_name,
        phone=employee.phone,
        tms_role_code=employee.tms_role_code,
        tms_role_description=employee.tms_role_description,
        contract_type=employee.contract_type,
        datore_lavoro=employee.datore_lavoro,
        organization_function=employee.organization_function,
        organization_department=employee.organization_department,
        organization_role=employee.organization_role,
        manager_name=employee.manager_name,
        birth_date=employee.birth_date,
        is_active=employee.is_active,
        default_operational_area_id=employee.default_operational_area_id,
        default_operational_area_name=employee.default_operational_area.name if employee.default_operational_area else None,
        default_immobile=employee.default_immobile,
    )


def _build_local_user_team(db: Session, employee: Employee) -> LocalUserTeam | None:
    membership = db.scalar(
        select(TeamMember).where(TeamMember.employee_id == employee.id)
    )
    team_data = None
    if membership:
        team = db.scalar(select(Team).where(Team.id == membership.team_id))
        if team:
            all_members = db.scalars(
                select(Employee)
                .join(TeamMember, TeamMember.employee_id == Employee.id)
                .where(TeamMember.team_id == team.id)
            ).all()
            team_data = LocalUserTeam(
                id=team.id,
                name=team.name,
                icon=team.icon,
                color=team.color,
                team_leader_id=team.team_leader_employee_id,
                team_leader_name=team.team_leader.full_name if team.team_leader else None,
                members=[
                    LocalUserTeamMember(id=m.id, tms_id=m.tms_id, full_name=m.full_name)
                    for m in all_members
                ],
            )
    return team_data


@router.post("/local-user/login", response_model=LocalUserTokenResponse)
async def login_local_user(
    payload: LocalUserValidationRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> LocalUserTokenResponse:
    check_login_allowed(request, payload.username)
    try:
        employee = _authenticate_local_user_or_401(db, payload)
    except HTTPException as exc:
        if exc.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN):
            record_login_failure(request, payload.username)
        raise
    reset_login_failures(request, payload.username)
    record_audit_log(
        db,
        action="login",
        entity="auth",
        actor_name=employee.full_name,
        detail={
            "provider": "local_user",
            "employee_id": employee.id,
            "username": employee.local_user_username,
            "ip_address": request.client.host if request.client else None,
            "user_agent": request.headers.get("user-agent"),
        },
    )
    db.commit()
    team_data = _build_local_user_team(db, employee)
    access_token = create_access_token(
        subject=employee.local_user_username or employee.tms_id,
        role="local_user",
        token_type="local_user",
    )
    return LocalUserTokenResponse(
        access_token=access_token,
        expires_in=settings.jwt_expire_minutes * 60,
        employee=_serialize_external_employee(employee),
        team=team_data,
    )


@router.get("/local-user/employees", response_model=list[EmployeeListItem])
async def list_employees_for_local_user(
    db: Session = Depends(get_db),
    _: Employee = Depends(get_current_local_employee),
) -> list[EmployeeListItem]:
    employees = db.scalars(
        select(Employee)
        .where(Employee.is_active == True)
        .order_by(Employee.full_name)
    ).all()
    return [EmployeeListItem(tms_id=e.tms_id, full_name=e.full_name) for e in employees]


@router.get("/local-user/infinity-cross-mappings", response_model=LocalUserInfinityCrossMappingsResponse)
async def list_infinity_cross_mappings_for_local_user(
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> LocalUserInfinityCrossMappingsResponse:
    areas = db.scalars(
        select(OperationalArea)
        .where(OperationalArea.is_active.is_(True), OperationalArea.is_operational.is_(True))
        .order_by(OperationalArea.name.asc())
    ).all()

    area_options = [
        LocalUserOperationalAreaOption(
            id=area.id,
            area_code=area.area_code,
            name=area.name,
            buildings=building_codes(area.buildings, visibility="visible_in_reporting"),
            is_default=employee.default_operational_area_id == area.id,
        )
        for area in areas
    ]
    default_area = next((area for area in area_options if area.is_default), None)

    mappings = db.scalars(
        select(InfinityBillingCustomerSupplierMap)
        .where(InfinityBillingCustomerSupplierMap.is_active.is_(True))
        .options(
            selectinload(InfinityBillingCustomerSupplierMap.infinity_billing_item),
            selectinload(InfinityBillingCustomerSupplierMap.operational_area),
            selectinload(InfinityBillingCustomerSupplierMap.field_assignments).selectinload(
                InfinityMapFieldAssignment.field_definition
            ),
        )
        .order_by(
            InfinityBillingCustomerSupplierMap.customer_supplier_description.asc(),
            InfinityBillingCustomerSupplierMap.customer_supplier_code.asc(),
        )
    ).all()

    return LocalUserInfinityCrossMappingsResponse(
        employee=_serialize_external_employee(employee),
        default_operational_area=default_area,
        operational_areas=area_options,
        mappings=[
            LocalUserInfinityCrossMappingRow(
                id=item.id,
                infinity_billing_item_id=item.infinity_billing_item_id,
                infinity_billing_item_name=item.infinity_billing_item_name,
                customer_supplier_code=item.customer_supplier_code,
                customer_supplier_description=item.customer_supplier_description,
                jupiter_description=item.jupiter_description,
                operational_area_id=item.operational_area_id,
                operational_area_code=item.operational_area.area_code if item.operational_area else None,
                operational_area_name=item.operational_area_name,
                buildings=list(item.buildings or []),
                is_active=item.is_active,
                field_assignments=[
                    InfinityMapFieldAssignmentRead.from_orm_with_def(fa)
                    for fa in sorted(item.field_assignments, key=lambda a: a.sort_order)
                ],
            )
            for item in mappings
        ],
    )


@router.get("/local-user/me", response_model=LocalUserMyInfoResponse)
async def get_my_info_for_local_user(
    date_param: date | None = Query(default=None, alias="date"),
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> LocalUserMyInfoResponse:
    """Info di base del dipendente autenticato: anagrafica, pianificazione del giorno e assenze in corso/future
    (equivalente del box "Le mie info" mostrato nella home del portale THub)."""
    target_date = date_param or today_local()
    today_assignments, upcoming_absences, pending_count = build_personal_info(db, employee.id, target_date)
    return LocalUserMyInfoResponse(
        employee=_serialize_external_employee(employee),
        date=target_date,
        today_assignments=today_assignments,
        upcoming_absences=upcoming_absences,
        pending_count=pending_count,
    )


@router.get("/impersonate/{employee_id}", response_model=AuthUserRead)
def impersonate(
    employee_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> AuthUserRead:
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role != "admin":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli admin possono usare l'impersonificazione.")
    employee = db.get(Employee, employee_id)
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato.")
    return build_impersonation_view(db, employee)

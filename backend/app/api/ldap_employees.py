from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin, require_organization_access
from app.db import get_db
from app.models import Employee, LdapEmployee, User
from app.schemas import LdapEmployeeRead, LdapEmployeeTmsLinkUpdate, LdapEmployeeUnlockResponse
from app.services.audit import record_audit_log
from app.services.rate_limit import is_username_locked, reset_failures_for_username
from app.services.security import get_current_user

router = APIRouter(prefix="/ldap-employees", tags=["ldap-employees"], dependencies=[Depends(require_organization_access)])


def serialize_ldap_employee(employee: LdapEmployee) -> LdapEmployeeRead:
    return LdapEmployeeRead(
        id=employee.id,
        username=employee.username,
        display_name=employee.display_name,
        email=employee.email,
        distinguished_name=employee.distinguished_name,
        auth_user_id=employee.auth_user_id,
        tms_employee_id=employee.tms_employee_id,
        tms_employee_name=employee.tms_employee.full_name if employee.tms_employee else None,
        first_login_at=employee.first_login_at,
        last_login_at=employee.last_login_at,
        is_active=employee.is_active,
        is_linked_to_tms=employee.tms_employee_id is not None,
        is_login_locked=is_username_locked(employee.username),
        created_at=employee.created_at,
        updated_at=employee.updated_at,
    )


@router.get("", response_model=list[LdapEmployeeRead])
def list_ldap_employees(
    search: str | None = Query(default=None),
    active_only: bool = Query(default=True),
    db: Session = Depends(get_db),
) -> list[LdapEmployeeRead]:
    statement: Select[tuple[LdapEmployee]] = select(LdapEmployee).options(selectinload(LdapEmployee.tms_employee))

    if active_only:
        statement = statement.where(LdapEmployee.is_active.is_(True))

    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                LdapEmployee.username.ilike(pattern),
                LdapEmployee.display_name.ilike(pattern),
                LdapEmployee.email.ilike(pattern),
            )
        )

    statement = statement.order_by(LdapEmployee.last_login_at.desc().nullslast(), LdapEmployee.username.asc())
    return [serialize_ldap_employee(item) for item in db.scalars(statement).all()]


@router.patch("/{ldap_employee_id}/tms-link", response_model=LdapEmployeeRead)
def update_ldap_employee_tms_link(
    ldap_employee_id: str,
    payload: LdapEmployeeTmsLinkUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> LdapEmployeeRead:
    ldap_employee = db.scalar(
        select(LdapEmployee).where(LdapEmployee.id == ldap_employee_id).options(selectinload(LdapEmployee.tms_employee))
    )
    if ldap_employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LDAP employee not found.")

    previous_tms_employee_id = ldap_employee.tms_employee_id

    if payload.tms_employee_id is None:
        ldap_employee.tms_employee_id = None
    else:
        tms_employee = db.get(Employee, payload.tms_employee_id)
        if tms_employee is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="TMS employee not found.")

        existing_link = db.scalar(
            select(LdapEmployee).where(
                LdapEmployee.tms_employee_id == payload.tms_employee_id,
                LdapEmployee.id != ldap_employee.id,
            )
        )
        if existing_link is not None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="TMS employee already linked to another LDAP user.")

        ldap_employee.tms_employee_id = tms_employee.id

    record_audit_log(
        db,
        action="update",
        entity="ldap_employee_tms_link",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "ldap_employee_id": ldap_employee.id,
            "before": previous_tms_employee_id,
            "after": ldap_employee.tms_employee_id,
        },
    )
    db.commit()
    db.refresh(ldap_employee)
    return serialize_ldap_employee(ldap_employee)


@router.post("/{ldap_employee_id}/unlock-login", response_model=LdapEmployeeUnlockResponse)
def unlock_ldap_employee_login(
    ldap_employee_id: str,
    current_user: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> LdapEmployeeUnlockResponse:
    """Azzera il rate limit sui login falliti dell'utente (da qualsiasi IP).

    Evita all'helpdesk di dover riavviare il backend per sbloccare chi ha
    sbagliato password troppe volte; lo stato è in memoria del processo, quindi
    con più worker uvicorn lo sblocco vale solo per il worker che serve questa
    richiesta.
    """
    ldap_employee = db.get(LdapEmployee, ldap_employee_id)
    if ldap_employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="LDAP employee not found.")

    cleared = reset_failures_for_username(ldap_employee.username)

    record_audit_log(
        db,
        action="unlock_login",
        entity="ldap_employee",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "ldap_employee_id": ldap_employee.id,
            "username": ldap_employee.username,
            "cleared_keys": cleared,
        },
    )
    db.commit()
    return LdapEmployeeUnlockResponse(username=ldap_employee.username, cleared_keys=cleared)

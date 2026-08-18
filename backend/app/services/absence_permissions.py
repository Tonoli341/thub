from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import AppRole
from app.models import Employee, Justification, LdapEmployee, User
from app.services.hierarchy import collect_report_ids


DEFAULT_APPROVER_2_TMS_ID = "85"
DEFAULT_APPROVER_3_TMS_ID = "86"


@dataclass
class AbsencePermissionContext:
    employee: Employee | None
    allowed_employee_ids: set[str]
    visible_employee_ids: set[str]
    approval_required: bool
    approver_1: Employee | None
    approver_2: Employee | None
    approver_3: Employee | None
    is_admin: bool = False


def get_linked_tms_employee(db: Session, user: User) -> Employee | None:
    ldap_employee = db.scalar(
        select(LdapEmployee).where(LdapEmployee.auth_user_id == user.id).where(LdapEmployee.tms_employee_id.is_not(None))
    )
    if ldap_employee is None or ldap_employee.tms_employee_id is None:
        return None
    return db.get(Employee, ldap_employee.tms_employee_id)


def _resolve_default_approver_by_tms_id(db: Session, tms_id: str) -> Employee | None:
    return db.scalar(select(Employee).where(func.trim(Employee.tms_id) == tms_id))


def _resolve_role_descriptions(raw_value: str | None) -> set[str]:
    if not raw_value:
        return set()
    return {item.strip().upper() for item in raw_value.split(",") if item.strip()}


def resolve_approvers(db: Session, employee: Employee) -> tuple[Employee | None, Employee | None, Employee | None]:
    """Approvatori 1/2/3 di un dipendente, con i fallback di default già usati dal portale."""
    approver_1 = employee.absence_approver_1 or employee.manager
    approver_2 = employee.absence_approver_2 or _resolve_default_approver_by_tms_id(db, DEFAULT_APPROVER_2_TMS_ID)
    approver_3 = employee.absence_approver_3 or _resolve_default_approver_by_tms_id(db, DEFAULT_APPROVER_3_TMS_ID)
    return approver_1, approver_2, approver_3


def build_absence_permission_context(
    db: Session, user: User, impersonate_as: Employee | None = None
) -> AbsencePermissionContext:
    linked_employee = impersonate_as if impersonate_as is not None else get_linked_tms_employee(db, user)

    if linked_employee is None:
        all_ids = set(db.scalars(select(Employee.id).where(Employee.is_active.is_(True))).all())
        return AbsencePermissionContext(
            employee=None,
            allowed_employee_ids=all_ids,
            visible_employee_ids=all_ids,
            approval_required=False,
            approver_1=None,
            approver_2=None,
            approver_3=None,
            is_admin=True,
        )

    # Quando esiste un dipendente collegato, il suo ruolo applicativo prevale
    # sul ruolo storico dell'account users.
    is_admin = impersonate_as is None and (
        (linked_employee.app_role or "").upper() == AppRole.admin.value
    )

    allowed_ids: set[str] = set()
    if linked_employee.absence_can_request_for_self:
        allowed_ids.add(linked_employee.id)
    if linked_employee.absence_can_request_for_reports:
        allowed_ids.update(collect_report_ids(db, linked_employee.id))
    if linked_employee.absence_can_request_for_all:
        allowed_ids.update(db.scalars(select(Employee.id).where(Employee.is_active.is_(True))).all())
    else:
        role_descriptions = _resolve_role_descriptions(linked_employee.absence_allowed_role_descriptions)
        if role_descriptions:
            allowed_ids.update(
                db.scalars(
                    select(Employee.id).where(
                        Employee.is_active.is_(True),
                        func.upper(Employee.tms_role_description).in_(role_descriptions),
                    )
                ).all()
            )

    visible_ids = set(allowed_ids)
    if linked_employee.absence_can_view_all:
        visible_ids.update(db.scalars(select(Employee.id).where(Employee.is_active.is_(True))).all())

    approver_1, approver_2, approver_3 = resolve_approvers(db, linked_employee)

    return AbsencePermissionContext(
        employee=linked_employee,
        allowed_employee_ids=allowed_ids,
        visible_employee_ids=visible_ids,
        approval_required=linked_employee.absence_requires_approval,
        approver_1=approver_1,
        approver_2=approver_2,
        approver_3=approver_3,
        is_admin=is_admin,
    )


def can_view_justification(context: AbsencePermissionContext, justification: Justification, user: User) -> bool:
    return justification.employee_id in context.visible_employee_ids


def requires_my_approval(db: Session, context: AbsencePermissionContext, justification: Justification) -> bool:
    """Vero se l'utente corrente può approvare (e quindi anche eliminare) questa richiesta.

    Un admin può sempre approvare qualunque richiesta, comprese le proprie. Per tutti gli altri,
    gli approvatori vengono ricalcolati sulla configurazione odierna del dipendente, non su quella
    congelata sulla richiesta al momento della creazione: se l'approvatore di un dipendente cambia,
    la modifica deve valere anche per le richieste già esistenti e non ancora decise.
    """
    if context.is_admin:
        return True
    if context.employee is None:
        return False
    approver_1, approver_2, approver_3 = resolve_approvers(db, justification.employee)
    approver_ids = {
        approver_1.id if approver_1 else None,
        approver_2.id if approver_2 else None,
        approver_3.id if approver_3 else None,
    }
    return context.employee.id in approver_ids

from dataclasses import dataclass

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.enums import JustificationApprovalStatus
from app.models import Employee, Justification, LdapEmployee, User


DEFAULT_APPROVER_2_TMS_ID = "85"
DEFAULT_APPROVER_3_TMS_ID = "86"


@dataclass
class AbsencePermissionContext:
    employee: Employee | None
    allowed_employee_ids: set[str]
    approval_required: bool
    approver_1: Employee | None
    approver_2: Employee | None
    approver_3: Employee | None


def get_linked_tms_employee(db: Session, user: User) -> Employee | None:
    ldap_employee = db.scalar(
        select(LdapEmployee).where(LdapEmployee.auth_user_id == user.id).where(LdapEmployee.tms_employee_id.is_not(None))
    )
    if ldap_employee is None or ldap_employee.tms_employee_id is None:
        return None
    return db.get(Employee, ldap_employee.tms_employee_id)


def _collect_report_ids(db: Session, manager_employee_id: str) -> set[str]:
    collected: set[str] = set()
    queue = [manager_employee_id]

    while queue:
        current_id = queue.pop(0)
        rows = db.scalars(select(Employee.id).where(Employee.manager_employee_id == current_id, Employee.is_active.is_(True))).all()
        for employee_id in rows:
            if employee_id in collected:
                continue
            collected.add(employee_id)
            queue.append(employee_id)

    return collected


def _resolve_default_approver_by_tms_id(db: Session, tms_id: str) -> Employee | None:
    return db.scalar(select(Employee).where(func.trim(Employee.tms_id) == tms_id))


def _resolve_role_descriptions(raw_value: str | None) -> set[str]:
    if not raw_value:
        return set()
    return {item.strip().upper() for item in raw_value.split(",") if item.strip()}


def build_absence_permission_context(
    db: Session, user: User, impersonate_as: Employee | None = None
) -> AbsencePermissionContext:
    linked_employee = impersonate_as if impersonate_as is not None else get_linked_tms_employee(db, user)

    if linked_employee is None:
        all_ids = set(db.scalars(select(Employee.id).where(Employee.is_active.is_(True))).all())
        return AbsencePermissionContext(
            employee=None,
            allowed_employee_ids=all_ids,
            approval_required=False,
            approver_1=None,
            approver_2=None,
            approver_3=None,
        )

    allowed_ids: set[str] = set()
    if linked_employee.absence_can_request_for_self:
        allowed_ids.add(linked_employee.id)
    if linked_employee.absence_can_request_for_reports:
        allowed_ids.update(_collect_report_ids(db, linked_employee.id))
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

    approver_1 = linked_employee.absence_approver_1 or linked_employee.manager
    approver_2 = linked_employee.absence_approver_2 or _resolve_default_approver_by_tms_id(db, DEFAULT_APPROVER_2_TMS_ID)
    approver_3 = linked_employee.absence_approver_3 or _resolve_default_approver_by_tms_id(db, DEFAULT_APPROVER_3_TMS_ID)

    return AbsencePermissionContext(
        employee=linked_employee,
        allowed_employee_ids=allowed_ids,
        approval_required=linked_employee.absence_requires_approval,
        approver_1=approver_1,
        approver_2=approver_2,
        approver_3=approver_3,
    )


def can_view_justification(context: AbsencePermissionContext, justification: Justification, user: User) -> bool:
    return justification.employee_id in context.allowed_employee_ids


def requires_my_approval(context: AbsencePermissionContext, justification: Justification) -> bool:
    if context.employee is None:
        return False
    approver_ids = {
        justification.approver_1_employee_id,
        justification.approver_2_employee_id,
        justification.approver_3_employee_id,
    }
    return context.employee.id in approver_ids

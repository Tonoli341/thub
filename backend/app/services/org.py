from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee, OrgDepartment, OrgFunction


def propagate_org_to_reports(db: Session, employee: Employee) -> None:
    """Recursively propagate function/department to direct reports that have empty values."""
    if not employee.organization_function and not employee.organization_department:
        return
    reports = db.scalars(
        select(Employee).where(
            Employee.manager_employee_id == employee.id,
            Employee.is_active.is_(True),
        )
    ).all()
    for report in reports:
        changed = False
        if not report.organization_function and employee.organization_function:
            report.organization_function = employee.organization_function
            changed = True
        if not report.organization_department and employee.organization_department:
            report.organization_department = employee.organization_department
            changed = True
        if changed:
            propagate_org_to_reports(db, report)


def propagate_org_inheritance(db: Session) -> int:
    """Multi-pass propagation for all active employees. Handles arbitrarily deep hierarchies.

    Step 1: seed org fields on function/department responsibles from the org entity tables.
    Step 2: propagate through the manager chain until stable.
    """
    all_employees = db.scalars(select(Employee).where(Employee.is_active.is_(True))).all()
    employee_by_id = {e.id: e for e in all_employees}
    updated_ids: set[str] = set()

    # Step 1: sync responsibles from OrgFunction
    for func in db.scalars(select(OrgFunction).where(OrgFunction.is_active.is_(True), OrgFunction.responsible_employee_id.is_not(None))).all():
        responsible = employee_by_id.get(func.responsible_employee_id)  # type: ignore[arg-type]
        if responsible and responsible.organization_function != func.name:
            responsible.organization_function = func.name
            updated_ids.add(responsible.id)

    # Step 1b: sync responsibles from OrgDepartment
    for dept in db.scalars(select(OrgDepartment).where(OrgDepartment.is_active.is_(True), OrgDepartment.responsible_employee_id.is_not(None))).all():
        responsible = employee_by_id.get(dept.responsible_employee_id)  # type: ignore[arg-type]
        if responsible and responsible.organization_department != dept.name:
            responsible.organization_department = dept.name
            updated_ids.add(responsible.id)

    # Step 2: multi-pass manager-chain propagation
    changed = True
    while changed:
        changed = False
        for emp in all_employees:
            if not emp.manager_employee_id:
                continue
            manager = employee_by_id.get(emp.manager_employee_id)
            if not manager:
                continue
            if not emp.organization_function and manager.organization_function:
                emp.organization_function = manager.organization_function
                changed = True
                updated_ids.add(emp.id)
            if not emp.organization_department and manager.organization_department:
                emp.organization_department = manager.organization_department
                changed = True
                updated_ids.add(emp.id)

    return len(updated_ids)

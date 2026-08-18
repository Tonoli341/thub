"""Risoluzione della gerarchia manager → riporti.

Un'unica query su (id, manager_employee_id) e BFS in memoria, al posto di una
query per nodo ripetuta a ogni livello (pattern N+1 che era duplicato in tre
moduli diversi).
"""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Employee


def collect_report_ids(db: Session, manager_employee_id: str) -> set[str]:
    """Tutti gli id dei riporti (diretti e indiretti) attivi di un manager."""
    rows = db.execute(
        select(Employee.id, Employee.manager_employee_id).where(
            Employee.is_active.is_(True),
            Employee.manager_employee_id.is_not(None),
        )
    ).all()

    reports_by_manager: dict[str, list[str]] = {}
    for employee_id, manager_id in rows:
        reports_by_manager.setdefault(manager_id, []).append(employee_id)

    collected: set[str] = set()
    queue = [manager_employee_id]
    while queue:
        current_id = queue.pop()
        for employee_id in reports_by_manager.get(current_id, []):
            if employee_id not in collected:
                collected.add(employee_id)
                queue.append(employee_id)
    return collected

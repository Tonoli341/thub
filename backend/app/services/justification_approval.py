from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.enums import JustificationApprovalStatus, JustificationType
from app.models import Employee, Justification
from app.services.absence_permissions import resolve_approvers
from app.services.audit import record_audit_log
from app.services.email import notify_employee_approval_update
from app.services.graph_oof import sync_employee_oof


def employee_can_approve_justification(db: Session, employee: Employee | None, justification: Justification) -> bool:
    if employee is None:
        return False
    approver_1, approver_2, approver_3 = resolve_approvers(db, justification.employee)
    approver_ids = {
        approver_1.id if approver_1 else None,
        approver_2.id if approver_2 else None,
        approver_3.id if approver_3 else None,
    }
    return employee.id in approver_ids


def apply_justification_approval_update(
    db: Session,
    justification: Justification,
    approval_status: JustificationApprovalStatus,
    *,
    audit_actor_name: str,
    approver_name: str,
    approver_employee_id: str | None = None,
    approver_user_id: str | None = None,
) -> None:
    previous_status = justification.approval_status
    justification.approval_status = approval_status
    if approval_status == JustificationApprovalStatus.pending:
        justification.decided_by_name = None
        justification.decided_by_employee_id = None
        justification.decided_by_user_id = None
        justification.decided_at = None
    else:
        justification.decided_by_name = approver_name
        justification.decided_by_employee_id = approver_employee_id
        justification.decided_by_user_id = approver_user_id
        justification.decided_at = datetime.now(timezone.utc)
    record_audit_log(
        db,
        action="update",
        entity="justification_approval",
        actor_name=audit_actor_name,
        detail={
            "justification_id": justification.id,
            "before": previous_status.value,
            "after": approval_status.value,
        },
    )
    db.commit()
    db.refresh(justification)
    notify_employee_approval_update(db, justification, approver_name)
    # Approvazione/rifiuto ferie → aggiorna la risposta automatica Outlook.
    if justification.justification_type == JustificationType.ferie:
        sync_employee_oof(justification.employee_id)

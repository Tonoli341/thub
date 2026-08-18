from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_current_local_employee
from app.api.justifications import ensure_no_duplicate_justification, validate_justification_window
from app.db import get_db
from app.enums import JustificationApprovalStatus, JustificationType
from app.models import Employee, Justification
from app.schemas import AbsenceRequestCreate, AbsenceRequestRead, AbsenceRequestUpdate
from app.services.absence_permissions import resolve_approvers
from app.services.audit import record_audit_log
from app.services.email import notify_approvers_new_request
from app.services.graph_oof import sync_employee_oof

router = APIRouter(prefix="/absence-requests", tags=["absence-requests"])

LOCKED_STATUSES = {JustificationApprovalStatus.approved, JustificationApprovalStatus.rejected}


def _serialize(justification: Justification) -> AbsenceRequestRead:
    return AbsenceRequestRead(
        id=justification.id,
        employee_id=justification.employee_id,
        justification_type=justification.justification_type,
        description=justification.description,
        start_date=justification.start_date,
        end_date=justification.end_date,
        start_time=justification.start_time,
        end_time=justification.end_time,
        approval_status=justification.approval_status,
        approval_required=justification.approval_required,
        approver_1_employee_name=justification.approver_1_employee.full_name if justification.approver_1_employee else None,
        approver_2_employee_name=justification.approver_2_employee.full_name if justification.approver_2_employee else None,
        approver_3_employee_name=justification.approver_3_employee.full_name if justification.approver_3_employee else None,
        decided_by_name=justification.decided_by_name,
        decided_at=justification.decided_at,
        created_at=justification.created_at,
        updated_at=justification.updated_at,
    )


def _get_own_request_or_404(db: Session, request_id: str, employee_id: str) -> Justification:
    justification = db.scalar(
        select(Justification)
        .where(Justification.id == request_id, Justification.employee_id == employee_id)
        .options(
            selectinload(Justification.approver_1_employee),
            selectinload(Justification.approver_2_employee),
            selectinload(Justification.approver_3_employee),
        )
    )
    if justification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Richiesta ferie non trovata.")
    return justification


@router.post("", response_model=AbsenceRequestRead, status_code=status.HTTP_201_CREATED)
def create_absence_request(
    payload: AbsenceRequestCreate,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> AbsenceRequestRead:
    """Richiesta ferie del dipendente autenticato (sempre per sé stesso)."""
    approver_1, approver_2, approver_3 = resolve_approvers(db, employee)

    justification = Justification(
        employee_id=employee.id,
        justification_type=JustificationType.ferie,
        description=payload.description,
        start_date=payload.start_date,
        end_date=payload.end_date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        requested_by_employee_id=employee.id,
        created_by_name=employee.full_name,
        approval_required=employee.absence_requires_approval,
        approver_1_employee_id=approver_1.id if approver_1 else None,
        approver_2_employee_id=approver_2.id if approver_2 else None,
        approver_3_employee_id=approver_3.id if approver_3 else None,
        approval_status=(
            JustificationApprovalStatus.pending if employee.absence_requires_approval else JustificationApprovalStatus.approved
        ),
    )
    justification.employee = employee
    validate_justification_window(justification)
    ensure_no_duplicate_justification(db, justification)

    db.add(justification)
    record_audit_log(
        db,
        action="create",
        entity="justification",
        actor_name=employee.full_name,
        detail=payload.model_dump(mode="json") | {"employee_id": employee.id, "source": "webapp"},
    )
    db.commit()
    justification = _get_own_request_or_404(db, justification.id, employee.id)
    notify_approvers_new_request(db, justification)
    # Ferie approvata subito (nessuna approvazione richiesta) → risposta automatica.
    if justification.approval_status == JustificationApprovalStatus.approved:
        sync_employee_oof(justification.employee_id)
    return _serialize(justification)


@router.get("", response_model=list[AbsenceRequestRead])
def list_absence_requests(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=500),
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> list[AbsenceRequestRead]:
    """Elenco delle proprie richieste ferie (passate, in corso e future)."""
    statement = (
        select(Justification)
        .where(Justification.employee_id == employee.id)
        .options(
            selectinload(Justification.approver_1_employee),
            selectinload(Justification.approver_2_employee),
            selectinload(Justification.approver_3_employee),
        )
        .order_by(Justification.start_date.desc())
        .limit(limit)
    )
    if start:
        statement = statement.where(Justification.end_date >= start)
    if end:
        statement = statement.where(Justification.start_date <= end)

    return [_serialize(item) for item in db.scalars(statement).all()]


@router.put("/{request_id}", response_model=AbsenceRequestRead)
def update_absence_request(
    request_id: str,
    payload: AbsenceRequestUpdate,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> AbsenceRequestRead:
    """Modifica una propria richiesta ferie, solo se non ancora approvata/rifiutata."""
    justification = _get_own_request_or_404(db, request_id, employee.id)
    if justification.approval_status in LOCKED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La richiesta è già stata approvata o rifiutata e non può più essere modificata.",
        )

    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(justification, field, value)

    validate_justification_window(justification)
    ensure_no_duplicate_justification(db, justification, exclude_id=request_id)

    record_audit_log(
        db,
        action="update",
        entity="justification",
        actor_name=employee.full_name,
        detail={
            "justification_id": justification.id,
            "changes": payload.model_dump(exclude_unset=True, mode="json"),
            "source": "webapp",
        },
    )
    db.commit()
    justification = _get_own_request_or_404(db, request_id, employee.id)
    return _serialize(justification)


@router.delete("/{request_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_absence_request(
    request_id: str,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> Response:
    """Cancella una propria richiesta ferie, solo se non ancora approvata/rifiutata."""
    justification = _get_own_request_or_404(db, request_id, employee.id)
    if justification.approval_status in LOCKED_STATUSES:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="La richiesta è già stata approvata o rifiutata e non può più essere cancellata.",
        )

    record_audit_log(
        db,
        action="delete",
        entity="justification",
        actor_name=employee.full_name,
        detail={"justification_id": justification.id, "source": "webapp"},
    )
    db.delete(justification)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

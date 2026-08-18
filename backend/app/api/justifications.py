from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_impersonation_employee
from app.db import get_db
from app.enums import JustificationApprovalStatus, JustificationType
from app.models import Employee, Justification, User
from app.schemas import JustificationApprovalUpdate, JustificationCreate, JustificationRead, JustificationUpdate
from app.services.absence_permissions import (
    build_absence_permission_context,
    can_view_justification,
    requires_my_approval,
)
from app.services.audit import record_audit_log
from app.services.email import notify_approvers_new_request
from app.services.graph_oof import sync_employee_oof
from app.services.justification_approval import apply_justification_approval_update
from app.services.security import get_current_user

router = APIRouter(prefix="/justifications", tags=["justifications"])


def serialize_justification(justification: Justification, requires_my_approval_flag: bool) -> JustificationRead:
    return JustificationRead(
        id=justification.id,
        employee_id=justification.employee_id,
        employee_name=justification.employee.full_name,
        justification_type=justification.justification_type,
        description=justification.description,
        start_date=justification.start_date,
        end_date=justification.end_date,
        start_time=justification.start_time,
        end_time=justification.end_time,
        approval_status=justification.approval_status,
        approval_required=justification.approval_required,
        requested_by_employee_id=justification.requested_by_employee_id,
        requested_by_employee_name=justification.requested_by_employee.full_name if justification.requested_by_employee else None,
        approver_1_employee_id=justification.approver_1_employee_id,
        approver_1_employee_name=justification.approver_1_employee.full_name if justification.approver_1_employee else None,
        approver_2_employee_id=justification.approver_2_employee_id,
        approver_2_employee_name=justification.approver_2_employee.full_name if justification.approver_2_employee else None,
        approver_3_employee_id=justification.approver_3_employee_id,
        approver_3_employee_name=justification.approver_3_employee.full_name if justification.approver_3_employee else None,
        requires_my_approval=requires_my_approval_flag,
        created_by_name=justification.created_by_name
        or (justification.requested_by_employee.full_name if justification.requested_by_employee else None),
        decided_by_name=justification.decided_by_name,
        decided_by_employee_id=justification.decided_by_employee_id,
        decided_by_user_id=justification.decided_by_user_id,
        decided_at=justification.decided_at,
        created_at=justification.created_at,
        updated_at=justification.updated_at,
    )


def validate_justification_window(justification: Justification) -> None:
    if justification.end_date < justification.start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be after start date.")
    if justification.end_time <= justification.start_time:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End time must be after start time.")


def ensure_no_duplicate_justification(
    db: Session,
    justification: Justification,
    exclude_id: str | None = None,
) -> None:
    statement = select(Justification).where(
        Justification.employee_id == justification.employee_id,
        Justification.start_date <= justification.end_date,
        Justification.end_date >= justification.start_date,
        Justification.start_time < justification.end_time,
        Justification.end_time > justification.start_time,
        # le richieste rifiutate non devono bloccare una nuova richiesta sullo stesso periodo
        Justification.approval_status != JustificationApprovalStatus.rejected,
    )
    if exclude_id is not None:
        statement = statement.where(Justification.id != exclude_id)

    duplicate = db.scalar(statement)
    if duplicate is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esiste gia un'assenza sovrapposta per questo dipendente nel periodo selezionato.",
        )


def get_employee_or_404(db: Session, employee_id: str) -> Employee:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")
    return employee


def get_justification_or_404(db: Session, justification_id: str) -> Justification:
    justification = db.scalar(
        select(Justification)
        .where(Justification.id == justification_id)
        .options(
            selectinload(Justification.employee),
            selectinload(Justification.requested_by_employee),
            selectinload(Justification.approver_1_employee),
            selectinload(Justification.approver_2_employee),
            selectinload(Justification.approver_3_employee),
        )
    )
    if justification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Justification not found.")
    return justification


@router.get("", response_model=list[JustificationRead])
def list_justifications(
    start: date = Query(...),
    end: date = Query(...),
    employee_id: str | None = Query(default=None),
    only_pending_approvals: bool = Query(default=False),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> list[JustificationRead]:
    context = build_absence_permission_context(db, current_user, impersonate_as=impersonate_employee)
    statement = (
        select(Justification)
        .join(Justification.employee)
        .options(
            selectinload(Justification.employee),
            selectinload(Justification.requested_by_employee),
            selectinload(Justification.approver_1_employee),
            selectinload(Justification.approver_2_employee),
            selectinload(Justification.approver_3_employee),
        )
        .where(Justification.start_date <= end, Justification.end_date >= start)
        .order_by(Justification.start_date.asc(), Employee.full_name.asc())
    )
    if employee_id:
        statement = statement.where(Justification.employee_id == employee_id)
    rows = db.scalars(statement).all()
    approval_flags = {item.id: requires_my_approval(db, context, item) for item in rows}
    justifications = [
        item
        for item in rows
        if can_view_justification(context, item, current_user) or approval_flags[item.id]
    ]
    if only_pending_approvals:
        justifications = [item for item in justifications if approval_flags[item.id]]
    return [serialize_justification(item, approval_flags[item.id]) for item in justifications]


@router.post("", response_model=JustificationRead, status_code=status.HTTP_201_CREATED)
def create_justification(
    payload: JustificationCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JustificationRead:
    context = build_absence_permission_context(db, current_user)
    employee = get_employee_or_404(db, payload.employee_id)
    if payload.employee_id not in context.allowed_employee_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to request absence for this employee.")
    justification = Justification(**payload.model_dump())
    justification.employee = employee
    justification.requested_by_employee_id = context.employee.id if context.employee else None
    justification.created_by_name = (
        context.employee.full_name if context.employee else (current_user.display_name or current_user.username)
    )
    justification.approval_required = context.approval_required
    justification.approver_1_employee_id = context.approver_1.id if context.approver_1 else None
    justification.approver_2_employee_id = context.approver_2.id if context.approver_2 else None
    justification.approver_3_employee_id = context.approver_3.id if context.approver_3 else None
    justification.approval_status = (
        JustificationApprovalStatus.pending if context.approval_required else JustificationApprovalStatus.approved
    )
    validate_justification_window(justification)
    ensure_no_duplicate_justification(db, justification)

    db.add(justification)
    record_audit_log(db, action="create", entity="justification", actor_name=current_user.username, detail=payload.model_dump(mode="json"))
    db.commit()
    justification = get_justification_or_404(db, justification.id)
    # Notifica gli approvatori per ogni richiesta pendente, anche se inserita
    # da un manager per conto del dipendente: altrimenti resta in attesa in silenzio.
    if justification.approval_required:
        notify_approvers_new_request(db, justification)
    # Ferie già approvata alla creazione (nessuna approvazione richiesta) → OOF.
    if justification.justification_type == JustificationType.ferie:
        sync_employee_oof(justification.employee_id)
    return serialize_justification(justification, requires_my_approval(db, context, justification))


@router.put("/{justification_id}", response_model=JustificationRead)
def update_justification(
    justification_id: str,
    payload: JustificationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JustificationRead:
    context = build_absence_permission_context(db, current_user)
    justification = get_justification_or_404(db, justification_id)
    if justification.employee_id not in context.allowed_employee_ids and not requires_my_approval(db, context, justification):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to update this absence.")

    previous_state = serialize_justification(justification, requires_my_approval(db, context, justification)).model_dump(mode="json")
    previous_employee_id = justification.employee_id
    was_ferie = justification.justification_type == JustificationType.ferie
    changes = payload.model_dump(exclude_unset=True)

    if "employee_id" in changes:
        next_employee = get_employee_or_404(db, changes.pop("employee_id"))
        if next_employee.id not in context.allowed_employee_ids:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to update this absence.")
        justification.employee = next_employee

    for field, value in changes.items():
        setattr(justification, field, value)

    validate_justification_window(justification)
    ensure_no_duplicate_justification(db, justification, exclude_id=justification_id)

    record_audit_log(
        db,
        action="update",
        entity="justification",
        actor_name=current_user.username,
        detail={"before": previous_state, "after": serialize_justification(justification, requires_my_approval(db, context, justification)).model_dump(mode="json")},
    )
    db.commit()
    justification = get_justification_or_404(db, justification_id)
    # Modifica ferie (date/dipendente/tipo) → risincronizza l'OOF degli interessati.
    if was_ferie or justification.justification_type == JustificationType.ferie:
        sync_employee_oof(justification.employee_id)
        if previous_employee_id != justification.employee_id:
            sync_employee_oof(previous_employee_id)
    return serialize_justification(justification, requires_my_approval(db, context, justification))


@router.patch("/{justification_id}/approval", response_model=JustificationRead)
def update_justification_approval(
    justification_id: str,
    payload: JustificationApprovalUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> JustificationRead:
    context = build_absence_permission_context(db, current_user)
    justification = get_justification_or_404(db, justification_id)
    if not requires_my_approval(db, context, justification):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to approve this absence.")

    approver_name = context.employee.full_name if context.employee else current_user.username
    apply_justification_approval_update(
        db,
        justification,
        payload.approval_status,
        audit_actor_name=current_user.username,
        approver_name=approver_name,
        approver_employee_id=context.employee.id if context.employee else None,
        approver_user_id=current_user.id,
    )
    justification = get_justification_or_404(db, justification_id)
    return serialize_justification(justification, requires_my_approval(db, context, justification))


@router.delete("/{justification_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_justification(
    justification_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    context = build_absence_permission_context(db, current_user)
    justification = get_justification_or_404(db, justification_id)
    if justification.employee_id not in context.allowed_employee_ids and not requires_my_approval(db, context, justification):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Not authorized to delete this absence.")

    previous_state = serialize_justification(justification, requires_my_approval(db, context, justification)).model_dump(mode="json")
    record_audit_log(
        db,
        action="delete",
        entity="justification",
        actor_name=current_user.username,
        detail=previous_state,
    )
    deleted_employee_id = justification.employee_id
    was_ferie = justification.justification_type == JustificationType.ferie
    db.delete(justification)
    db.commit()
    # Cancellazione ferie → ricalcola l'OOF (rimuove o passa alla prossima ferie).
    if was_ferie:
        sync_employee_oof(deleted_employee_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)

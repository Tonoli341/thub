from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_maintenance_access
from app.db import get_db
from app.maintenance_asset_models import MaintenanceDeadline
from app.maintenance_deadline_schemas import (
    MaintenanceDeadlineComplete,
    MaintenanceDeadlineCreate,
    MaintenanceDeadlinePostpone,
    MaintenanceDeadlineRead,
)
from app.models import User
from app.services import maintenance_assets, maintenance_deadlines as service
from app.services.maintenance_export import export_maintenance_deadlines_xlsx

router = APIRouter(prefix="/maintenance", tags=["maintenance-deadlines"])


def serialize_deadline(db: Session, deadline: MaintenanceDeadline) -> MaintenanceDeadlineRead:
    current_hours, projected_due_date = service.hours_projection(db, deadline)
    return MaintenanceDeadlineRead(
        id=deadline.id,
        asset_id=deadline.asset_id,
        asset_internal_code=deadline.asset.internal_code,
        asset_class_label=deadline.asset.asset_type.asset_class.label,
        asset_type_label=deadline.asset.asset_type.label,
        deadline_type=deadline.deadline_type,
        due_date=deadline.due_date,
        recurrence_basis=deadline.recurrence_basis,
        recurrence_days=deadline.recurrence_days,
        due_hours=float(deadline.due_hours) if deadline.due_hours is not None else None,
        recurrence_hours=deadline.recurrence_hours,
        last_completed_hours=float(deadline.last_completed_hours) if deadline.last_completed_hours is not None else None,
        current_hours=current_hours,
        projected_due_date=projected_due_date,
        notice_thresholds_days=deadline.notice_thresholds_days,
        last_completed_at=deadline.last_completed_at,
        postponed_reason=deadline.postponed_reason,
        is_active=deadline.is_active,
        urgency=service.compute_urgency(db, deadline, projection=(current_hours, projected_due_date)),
    )


@router.get("/deadlines", response_model=list[MaintenanceDeadlineRead])
def list_all_deadlines(
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceDeadlineRead]:
    return [serialize_deadline(db, item) for item in service.list_deadlines(db)]


@router.get("/deadlines/export")
def export_deadlines(
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> Response:
    content = export_maintenance_deadlines_xlsx(db, service.list_deadlines(db))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="manutenzioni-scadenze.xlsx"'},
    )


@router.get("/assets/{asset_id}/deadlines", response_model=list[MaintenanceDeadlineRead])
def list_asset_deadlines(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceDeadlineRead]:
    maintenance_assets.get_asset_or_404(db, asset_id)
    return [serialize_deadline(db, item) for item in service.list_deadlines(db, asset_id=asset_id)]


@router.post(
    "/assets/{asset_id}/deadlines",
    response_model=MaintenanceDeadlineRead,
    status_code=status.HTTP_201_CREATED,
)
def create_deadline(
    asset_id: str,
    payload: MaintenanceDeadlineCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceDeadlineRead:
    asset = maintenance_assets.get_asset_or_404(db, asset_id)
    deadline = service.create_deadline(
        db,
        asset,
        deadline_type=payload.deadline_type,
        due_date=payload.due_date,
        recurrence_basis=payload.recurrence_basis,
        recurrence_days=payload.recurrence_days,
        due_hours=payload.due_hours,
        recurrence_hours=payload.recurrence_hours,
        notice_thresholds_days=payload.notice_thresholds_days,
        last_completed_at=payload.last_completed_at,
        last_completed_hours=payload.last_completed_hours,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(deadline)
    return serialize_deadline(db, deadline)


@router.post("/deadlines/{deadline_id}/complete", response_model=MaintenanceDeadlineRead)
def complete_deadline(
    deadline_id: str,
    payload: MaintenanceDeadlineComplete,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceDeadlineRead:
    deadline = service.get_deadline_or_404(db, deadline_id)
    service.complete_deadline(
        db,
        deadline,
        completed_date=payload.completed_date,
        completed_hours=payload.completed_hours,
        confirm_next_due_date=payload.confirm_next_due_date,
        next_due_date_override=payload.next_due_date,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(deadline)
    return serialize_deadline(db, deadline)


@router.post("/deadlines/{deadline_id}/postpone", response_model=MaintenanceDeadlineRead)
def postpone_deadline(
    deadline_id: str,
    payload: MaintenanceDeadlinePostpone,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceDeadlineRead:
    deadline = service.get_deadline_or_404(db, deadline_id)
    service.postpone_deadline(
        db,
        deadline,
        new_due_date=payload.new_due_date,
        reason=payload.reason,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(deadline)
    return serialize_deadline(db, deadline)


@router.delete("/deadlines/{deadline_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_deadline(
    deadline_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    deadline = service.get_deadline_or_404(db, deadline_id)
    service.delete_deadline(db, deadline, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/deadlines/{deadline_id}/ack", status_code=status.HTTP_204_NO_CONTENT)
def ack_deadline(
    deadline_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> Response:
    service.get_deadline_or_404(db, deadline_id)
    service.ack_deadline(db, deadline_id, current_user.id)
    try:
        db.commit()
    except IntegrityError:
        # Doppio submit o richiesta duplicata (retry di rete, doppio tab):
        # l'ack esiste già per questo utente, non è un errore per il chiamante.
        db.rollback()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

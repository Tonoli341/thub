from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_local_employee, require_admin
from app.db import get_db
from app.models import DailyRecord, Employee, OperationalArea, User
from app.schemas import (
    DailyRecordCreate,
    DailyRecordCreateResponse,
    DailyRecordRead,
    DailyRecordUpdate,
    PauseEntry,
)
from app.services.audit import record_audit_log
from app.services.portal_auth import build_auth_user_read
from app.services.security import get_current_user

router = APIRouter(prefix="/daily-records", tags=["daily-records"])


def _serialize_daily_record(
    record: DailyRecord,
    *,
    employee_name: str | None = None,
    operational_area_name: str | None = None,
) -> DailyRecordRead:
    return DailyRecordRead(
        id=record.id,
        employee_id=record.employee_id,
        employee_name=employee_name,
        operational_area_id=record.operational_area_id,
        operational_area_name=operational_area_name,
        building=record.building,
        date=record.date,
        started_at=record.started_at,
        ended_at=record.ended_at,
        pauses=[item if isinstance(item, dict) else item.model_dump() for item in (record.pauses or [])],
        work_seconds=record.work_seconds,
        pause_seconds=record.pause_seconds,
        created_at=record.created_at,
    )


@router.post("", response_model=DailyRecordCreateResponse, status_code=status.HTTP_200_OK)
def create_daily_record(
    payload: DailyRecordCreate,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_local_employee),
) -> DailyRecordCreateResponse:
    if payload.employee_id != current_employee.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Puoi registrare solo la tua giornata.")

    existing = db.scalar(
        select(DailyRecord).where(
            DailyRecord.employee_id == payload.employee_id,
            DailyRecord.date == payload.date,
        )
    )

    pauses_payload = [item.model_dump(mode="json") for item in payload.pauses]
    if existing is None:
        record = DailyRecord(
            employee_id=payload.employee_id,
            operational_area_id=payload.operational_area_id,
            building=payload.building,
            date=payload.date,
            started_at=payload.started_at,
            ended_at=payload.ended_at,
            pauses=pauses_payload,
            work_seconds=payload.work_seconds,
            pause_seconds=payload.pause_seconds,
        )
        db.add(record)
    else:
        record = existing
        record.operational_area_id = payload.operational_area_id
        record.building = payload.building
        record.started_at = payload.started_at
        record.ended_at = payload.ended_at
        record.pauses = pauses_payload
        record.work_seconds = payload.work_seconds
        record.pause_seconds = payload.pause_seconds

    record_audit_log(
        db,
        action="create" if existing is None else "update",
        entity="daily_record",
        actor_name=current_employee.full_name,
        detail={"employee_id": payload.employee_id, "date": payload.date.isoformat()},
    )
    db.commit()
    db.refresh(record)
    return DailyRecordCreateResponse(id=record.id, date=record.date)


@router.get("/me", response_model=DailyRecordRead)
def get_my_daily_record(
    date: date = Query(...),
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_local_employee),
) -> DailyRecordRead:
    record = db.scalar(
        select(DailyRecord).where(
            DailyRecord.employee_id == current_employee.id,
            DailyRecord.date == date,
        )
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Nessuna giornata registrata per questa data.")

    operational_area_name = None
    if record.operational_area_id:
        area = db.get(OperationalArea, record.operational_area_id)
        operational_area_name = area.name if area else None

    return _serialize_daily_record(
        record,
        employee_name=current_employee.full_name,
        operational_area_name=operational_area_name,
    )


@router.get("", response_model=list[DailyRecordRead])
def list_daily_records(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    employee_id: str | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[DailyRecordRead]:
    auth = build_auth_user_read(db, current_user)
    if not auth.can_access_timesheets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso rendicontazioni non consentito.")

    stmt = select(DailyRecord).order_by(DailyRecord.date.desc(), DailyRecord.started_at.desc()).limit(limit)
    if start_date:
        stmt = stmt.where(DailyRecord.date >= start_date)
    if end_date:
        stmt = stmt.where(DailyRecord.date <= end_date)
    if employee_id:
        stmt = stmt.where(DailyRecord.employee_id == employee_id)

    records = list(db.scalars(stmt).all())
    if not records:
        return []

    employee_ids = {record.employee_id for record in records}
    area_ids = {record.operational_area_id for record in records if record.operational_area_id}

    employee_map = {
        employee.id: employee.full_name
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all()
    } if employee_ids else {}
    area_map = {
        area.id: area.name
        for area in db.scalars(select(OperationalArea).where(OperationalArea.id.in_(area_ids))).all()
    } if area_ids else {}

    return [
        _serialize_daily_record(
            record,
            employee_name=employee_map.get(record.employee_id),
            operational_area_name=area_map.get(record.operational_area_id) if record.operational_area_id else None,
        )
        for record in records
    ]


def _as_utc(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _apply_pauses(record: DailyRecord, pauses: list[PauseEntry]) -> None:
    """Valida gli intervalli di pausa e ricalcola i totali della giornata.

    Gli intervalli sono la fonte di verità: `pause_seconds` è la loro somma e
    `work_seconds` il lordo al netto delle pause. Vengono rifiutati intervalli
    invertiti, sovrapposti (conterebbero due volte) o fuori dal turno.
    """
    ordered = sorted(pauses, key=lambda p: _as_utc(p.started_at))

    total = 0
    previous_end: datetime | None = None
    for pause in ordered:
        started, ended = _as_utc(pause.started_at), _as_utc(pause.ended_at)
        if ended <= started:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Ogni pausa deve avere l'orario di fine successivo a quello di inizio.",
            )
        if previous_end is not None and started < previous_end:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Le pause non possono sovrapporsi.",
            )
        if started < _as_utc(record.started_at) or (
            record.ended_at is not None and ended > _as_utc(record.ended_at)
        ):
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Le pause devono essere comprese tra l'inizio e la fine della giornata.",
            )
        total += int((ended - started).total_seconds())
        previous_end = ended

    record.pause_seconds = total

    if record.ended_at is not None:
        gross = int((_as_utc(record.ended_at) - _as_utc(record.started_at)).total_seconds())
        if total >= gross:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Le pause non possono coprire l'intera giornata.",
            )
        record.work_seconds = gross - total


@router.patch("/admin/{record_id}", response_model=DailyRecordRead)
def admin_update_daily_record(
    record_id: str,
    payload: DailyRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> DailyRecordRead:
    """Modifica una presenza registrata. Solo Admin.

    Aggiorna solo i campi effettivamente inviati (exclude_unset). Se arriva
    `pauses`, gli intervalli sono la fonte di verità: `pause_seconds` e
    `work_seconds` vengono ricalcolati da lì, così i totali non possono
    divergere dal dettaglio.
    """
    record = db.get(DailyRecord, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Presenza non trovata.")

    updates = payload.model_dump(exclude_unset=True)
    # La colonna è JSON: i datetime vanno serializzati come stringhe ISO.
    if "pauses" in updates:
        updates["pauses"] = [item.model_dump(mode="json") for item in (payload.pauses or [])]

    for key, value in updates.items():
        setattr(record, key, value)

    if record.ended_at is not None and _as_utc(record.ended_at) <= _as_utc(record.started_at):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="L'orario di fine deve essere successivo a quello di inizio.",
        )

    if "pauses" in updates:
        _apply_pauses(record, payload.pauses or [])

    record_audit_log(
        db,
        action="admin_update",
        entity="daily_record",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"id": record.id, "changes": {k: str(v) for k, v in updates.items()}},
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esiste già una presenza per questo dipendente in questa data.",
        ) from exc
    db.refresh(record)

    employee = db.get(Employee, record.employee_id)
    operational_area_name = None
    if record.operational_area_id:
        area = db.get(OperationalArea, record.operational_area_id)
        operational_area_name = area.name if area else None

    return _serialize_daily_record(
        record,
        employee_name=employee.full_name if employee else None,
        operational_area_name=operational_area_name,
    )


@router.delete("/admin/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_daily_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> None:
    """Elimina definitivamente una presenza registrata. Solo Admin, senza passare dal DB."""
    record = db.get(DailyRecord, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Presenza non trovata.")
    record_audit_log(
        db,
        action="admin_delete",
        entity="daily_record",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"id": record.id, "employee_id": record.employee_id, "date": record.date.isoformat()},
    )
    db.delete(record)
    db.commit()

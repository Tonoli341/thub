from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from fastapi.responses import JSONResponse
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_current_local_employee, require_admin, require_timesheets_access
from app.services.active_activities import (
    compute_conflict_key,
    missing_required_fields,
    normalize_field_value,
    required_fields,
)
from app.services.audit import record_audit_log
from app.services.normalization import building_codes
from app.db import get_db
from app.models import ActiveActivity, ActivityRecord, Employee, InfinityBillingCustomerSupplierMap, OperationalArea, User
from app.schemas import (
    ActiveActivityAdminRead,
    ActiveActivityClose,
    ActiveActivityRead,
    ActiveActivityStart,
    ActiveActivityUpdate,
    ActivityEmployeeHoursRow,
    ActivityLastLocationRead,
    ActivityLocationHoursRow,
    ActivityMappingHoursRow,
    ActivityRecordAdminRead,
    ActivityRecordBulkCreate,
    ActivityRecordBulkResult,
    ActivityRecordCreate,
    ActivityRecordRead,
    ActivityRecordStatsResponse,
    ActivityRecordUpdate,
)

router = APIRouter(prefix="/activity-records", tags=["activity-records"])


# ── Insert helpers ────────────────────────────────────────────────────────────

def _create_record(db: Session, data: ActivityRecordCreate) -> ActivityRecord | None:
    """Insert one record; return None on duplicate (idempotent retry)."""
    record = ActivityRecord(
        employee_id=data.employee_id,
        mapping_id=data.mapping_id,
        operational_area_id=data.operational_area_id,
        building=data.building,
        started_at=data.started_at,
        ended_at=data.ended_at,
        duration_seconds=data.duration_seconds,
        field_values=data.field_values,
    )
    db.add(record)
    try:
        db.flush()
        return record
    except IntegrityError:
        db.rollback()
        return None


# ── Local-user endpoints ──────────────────────────────────────────────────────

@router.post("", response_model=ActivityRecordRead, status_code=status.HTTP_201_CREATED)
def create_activity_record(
    payload: ActivityRecordCreate,
    db: Session = Depends(get_db),
    _employee: Employee = Depends(get_current_local_employee),
) -> ActivityRecord:
    record = _create_record(db, payload)
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record già esistente (stessa matricola, incrocio e orario di inizio).",
        )
    record_audit_log(
        db,
        action="create",
        entity="activity_record",
        actor_name=_employee.full_name,
        detail={"employee_id": payload.employee_id, "mapping_id": payload.mapping_id, "started_at": payload.started_at.isoformat()},
    )
    db.commit()
    db.refresh(record)
    return record


@router.post("/bulk", response_model=ActivityRecordBulkResult, status_code=status.HTTP_200_OK)
def bulk_create_activity_records(
    payload: ActivityRecordBulkCreate,
    db: Session = Depends(get_db),
    _employee: Employee = Depends(get_current_local_employee),
) -> ActivityRecordBulkResult:
    """Inserisce fino a 500 record. Duplicati ignorati silenziosamente (idempotente)."""
    created = 0
    duplicates = 0

    for item in payload.records:
        if _create_record(db, item) is None:
            duplicates += 1
        else:
            created += 1

    record_audit_log(
        db,
        action="bulk_create",
        entity="activity_record",
        actor_name=_employee.full_name,
        detail={"received": len(payload.records), "created": created, "duplicates": duplicates},
    )
    try:
        db.commit()
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(exc)) from exc

    return ActivityRecordBulkResult(created=created, duplicates=duplicates)


@router.get("/last-location", response_model=ActivityLastLocationRead)
def get_last_work_location(
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActivityLastLocationRead:
    """Area e immobile del record più recente dell'operatore (per started_at),
    timer attualmente aperti inclusi. Usato dalla webapp per precompilare il
    selettore area/immobile all'avvio di ogni attività.

    Restituisce i valori grezzi dell'ultimo record (anche se area/immobile non
    esistono più negli incroci: la validazione è a carico del client). Nessuno
    storico → 200 con tutti i campi null.
    """
    last_closed = db.scalar(
        select(ActivityRecord)
        .where(ActivityRecord.employee_id == employee.id)
        .order_by(ActivityRecord.started_at.desc())
        .limit(1)
    )
    last_open = db.scalar(
        select(ActiveActivity)
        .where(ActiveActivity.employee_id == employee.id)
        .order_by(ActiveActivity.started_at.desc())
        .limit(1)
    )
    candidates = [r for r in (last_closed, last_open) if r is not None]
    if not candidates:
        return ActivityLastLocationRead()

    last = max(candidates, key=lambda r: _as_utc(r.started_at))
    area = db.get(OperationalArea, last.operational_area_id) if last.operational_area_id else None
    return ActivityLastLocationRead(
        operational_area_id=last.operational_area_id,
        operational_area_name=area.name if area else None,
        building=last.building,
        worked_at=last.started_at,
    )


# ── Active activities (timer realtime multi-attività, local-user Bearer) ──────
#
# Un dipendente può avere più attività attive in parallelo, ognuna con timer e
# pausa indipendenti. Ogni timer è identificato dal suo `id` (UUID restituito da
# POST /active). Il backend è il punto di verità: il client mobile può avviare,
# mettere in pausa/riprendere e chiudere ciascuna attività singolarmente senza
# toccare il flusso già esistente di POST /activity-records (storico/offline).
#
# Nota routing: le rotte statiche (/active, /active/pause-all, /active/admin…)
# sono dichiarate PRIMA di /active/{activity_id} così FastAPI non le interpreta
# come un activity_id.

def _as_utc(dt: datetime) -> datetime:
    # I timestamp possono arrivare naive (client senza offset, backend SQLite
    # nei test): trattali come UTC per non far esplodere le sottrazioni.
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _elapsed_seconds(record: ActiveActivity, now: datetime) -> int:
    pause_seconds = record.pause_seconds
    if record.paused_at is not None:
        pause_seconds += int((now - _as_utc(record.paused_at)).total_seconds())
    return max(0, int((now - _as_utc(record.started_at)).total_seconds()) - pause_seconds)


def _read(db: Session, record: ActiveActivity, now: datetime | None = None) -> ActiveActivityRead:
    now = now or datetime.now(timezone.utc)
    # db.get passa dall'identity map della sessione: nelle liste l'area viene
    # letta dal database una sola volta anche se compare su più timer.
    area = db.get(OperationalArea, record.operational_area_id) if record.operational_area_id else None
    return ActiveActivityRead(
        id=record.id,
        employee_id=record.employee_id,
        mapping_id=record.mapping_id,
        operational_area_id=record.operational_area_id,
        operational_area_name=area.name if area else None,
        building=record.building,
        started_at=record.started_at,
        paused_at=record.paused_at,
        pause_seconds=record.pause_seconds,
        elapsed_seconds=_elapsed_seconds(record, now),
        status="paused" if record.paused_at is not None else "running",
        field_values=record.field_values or {},
        client_token=record.client_token,
        last_heartbeat_at=record.last_heartbeat_at,
        created_at=record.created_at,
    )


def _list_active_activities(db: Session, employee_id: str) -> list[ActiveActivity]:
    return list(
        db.scalars(
            select(ActiveActivity)
            .where(ActiveActivity.employee_id == employee_id)
            .order_by(ActiveActivity.started_at.asc())
        ).all()
    )


def _get_owned_activity(db: Session, employee_id: str, activity_id: str) -> ActiveActivity:
    record = db.scalar(
        select(ActiveActivity).where(
            ActiveActivity.id == activity_id,
            ActiveActivity.employee_id == employee_id,
        )
    )
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attività in corso non trovata.")
    return record


def _validated_location(db: Session, operational_area_id: str | None, building: str | None) -> tuple[str, str | None]:
    """Valida area/immobile scelti allo start di un timer.

    L'area è obbligatoria; l'immobile è obbligatorio solo se l'area ha immobili
    associati (gli stessi proposti all'operatore, cioè quelli visibili in
    rendicontazione) e deve appartenere all'area indicata.
    Ritorna (area_id, immobile normalizzato).
    """
    if not operational_area_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Campo obbligatorio mancante: area operativa.",
        )
    area = db.get(OperationalArea, operational_area_id)
    if area is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Area operativa non valida.",
        )
    codes = building_codes(area.buildings, visibility="visible_in_reporting")
    normalized = (building or "").strip().upper() or None
    if normalized is None:
        if codes:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Campo obbligatorio mancante: immobile (l'area selezionata ha immobili associati).",
            )
    elif normalized not in codes:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"L'immobile '{normalized}' non appartiene all'area operativa selezionata.",
        )
    return area.id, normalized


def _mapping_conflict_response() -> JSONResponse:
    # Il client mostra `error` all'operatore; `detail` resta per uniformità con
    # gli altri errori FastAPI.
    message = (
        "Esiste già un'attività in corso per questo incrocio con gli stessi "
        "campi obbligatori. Riprendila o chiudila prima di riavviarla."
    )
    return JSONResponse(
        status_code=status.HTTP_409_CONFLICT,
        content={"error": message, "detail": message},
    )


@router.post("/active", response_model=ActiveActivityRead, status_code=status.HTTP_201_CREATED)
def start_active_activity(
    payload: ActiveActivityStart,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActiveActivityRead | JSONResponse:
    """Avvia un nuovo timer in parallelo. 409 se esiste già un timer sullo stesso incrocio (mapping_id)."""
    # Retry idempotente sullo stesso client_token (es. dopo un timeout di rete)
    if payload.client_token:
        existing = db.scalar(
            select(ActiveActivity).where(
                ActiveActivity.employee_id == employee.id,
                ActiveActivity.client_token == payload.client_token,
            )
        )
        if existing is not None:
            return _read(db, existing)

    # Area e immobile vengono scelti dall'operatore a ogni avvio attività e,
    # come i campi obbligatori, non sono più modificabili a timer avviato.
    area_id, building = _validated_location(db, payload.operational_area_id, payload.building)

    # I campi obbligatori dell'incrocio identificano il timer insieme al
    # mapping: l'app li raccoglie allo start e non sono più modificabili.
    required = required_fields(db, payload.mapping_id)
    missing = missing_required_fields(required, payload.field_values)
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Campi obbligatori mancanti per questo incrocio: {', '.join(missing)}.",
        )
    conflict_key = compute_conflict_key(required, payload.field_values)

    # Conflitto solo sulla tripla (employee_id, mapping_id, conflict_key): ogni
    # riga di active_activities è un timer aperto (running o paused), quindi
    # basta verificarne l'esistenza. Un mapping diverso, o lo stesso mapping con
    # campi obbligatori diversi, può sempre partire.
    conflict = db.scalar(
        select(ActiveActivity).where(
            ActiveActivity.employee_id == employee.id,
            ActiveActivity.mapping_id == payload.mapping_id,
            ActiveActivity.conflict_key == conflict_key,
        )
    )
    if conflict is not None:
        return _mapping_conflict_response()

    now = datetime.now(timezone.utc)
    record = ActiveActivity(
        employee_id=employee.id,
        mapping_id=payload.mapping_id,
        conflict_key=conflict_key,
        operational_area_id=area_id,
        building=building,
        started_at=payload.started_at or now,
        field_values=payload.field_values,
        client_token=payload.client_token,
        last_heartbeat_at=now,
    )
    db.add(record)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        if payload.client_token:
            existing = db.scalar(
                select(ActiveActivity).where(
                    ActiveActivity.employee_id == employee.id,
                    ActiveActivity.client_token == payload.client_token,
                )
            )
            if existing is not None:
                return _read(db, existing)
        return _mapping_conflict_response()
    db.refresh(record)
    return _read(db, record, now)


@router.get("/active", response_model=list[ActiveActivityRead])
def list_active_activities(
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> list[ActiveActivityRead]:
    """Elenca tutte le attività in corso del dipendente e funge da heartbeat globale.

    Usato dall'app alla riapertura/reload per ricostruire tutti i timer aperti.
    """
    records = _list_active_activities(db, employee.id)
    now = datetime.now(timezone.utc)
    for r in records:
        r.last_heartbeat_at = now
    if records:
        db.commit()
    return [_read(db, r, now) for r in records]


@router.post("/active/pause-all", response_model=list[ActiveActivityRead])
def pause_all_active_activities(
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> list[ActiveActivityRead]:
    """Mette in pausa tutte le attività in corso non ancora in pausa (pausa pranzo, fine turno…)."""
    records = _list_active_activities(db, employee.id)
    now = datetime.now(timezone.utc)
    for r in records:
        if r.paused_at is None:
            r.paused_at = now
        r.last_heartbeat_at = now
    if records:
        db.commit()
    return [_read(db, r, now) for r in records]


@router.post("/active/resume-all", response_model=list[ActiveActivityRead])
def resume_all_active_activities(
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> list[ActiveActivityRead]:
    """Riprende tutte le attività attualmente in pausa."""
    records = _list_active_activities(db, employee.id)
    now = datetime.now(timezone.utc)
    for r in records:
        if r.paused_at is not None:
            r.pause_seconds += int((now - _as_utc(r.paused_at)).total_seconds())
            r.paused_at = None
        r.last_heartbeat_at = now
    if records:
        db.commit()
    return [_read(db, r, now) for r in records]


def _finalize_active_activity(
    db: Session,
    record: ActiveActivity,
    payload: ActiveActivityClose,
) -> ActivityRecord:
    now = datetime.now(timezone.utc)
    ended_at = payload.ended_at or now

    pause_seconds = record.pause_seconds
    if record.paused_at is not None:
        pause_seconds += int((now - _as_utc(record.paused_at)).total_seconds())

    duration_seconds = int((_as_utc(ended_at) - _as_utc(record.started_at)).total_seconds()) - pause_seconds
    if duration_seconds < 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Durata attività non valida: verificare orari e pause registrate.",
        )

    field_values = {**(record.field_values or {}), **(payload.field_values or {})}
    create_payload = ActivityRecordCreate(
        employee_id=record.employee_id,
        mapping_id=record.mapping_id,
        operational_area_id=record.operational_area_id,
        building=record.building,
        started_at=record.started_at,
        ended_at=ended_at,
        duration_seconds=duration_seconds,
        field_values=field_values,
    )

    activity_record = _create_record(db, create_payload)
    if activity_record is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Record già esistente (stessa matricola, incrocio e orario di inizio).",
        )

    db.delete(record)
    db.commit()
    db.refresh(activity_record)
    return activity_record


# ── Admin (portal JWT): visibilità e chiusura forzata dei timer aperti ────────

@router.get("/active/admin", response_model=list[ActiveActivityAdminRead])
def admin_list_active_activities(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_timesheets_access),
) -> list[ActiveActivityAdminRead]:
    """Visibilità operativa su tutti i timer aperti (per individuare sessioni abbandonate)."""
    stmt = select(ActiveActivity)
    if start_date:
        stmt = stmt.where(func.date(ActiveActivity.started_at) >= start_date)
    if end_date:
        stmt = stmt.where(func.date(ActiveActivity.started_at) <= end_date)
    records = list(db.scalars(stmt.order_by(ActiveActivity.started_at.desc())).all())
    if not records:
        return []

    employee_map, mapping_map, area_map = _load_lookup_maps(db, records)
    now = datetime.now(timezone.utc)

    result = []
    for r in records:
        mapping_desc, item_name, _jupiter_desc = mapping_map.get(r.mapping_id, (None, None, None))
        result.append(
            ActiveActivityAdminRead(
                id=r.id,
                employee_id=r.employee_id,
                employee_name=employee_map.get(r.employee_id),
                mapping_id=r.mapping_id,
                mapping_description=mapping_desc,
                infinity_item_name=item_name,
                operational_area_id=r.operational_area_id,
                operational_area_name=area_map.get(r.operational_area_id) if r.operational_area_id else None,
                building=r.building,
                started_at=r.started_at,
                paused_at=r.paused_at,
                pause_seconds=r.pause_seconds,
                elapsed_seconds=_elapsed_seconds(r, now),
                last_heartbeat_at=r.last_heartbeat_at,
            )
        )
    return result


@router.post("/active/admin/{activity_id}/close", response_model=ActivityRecordRead, status_code=status.HTTP_201_CREATED)
def admin_close_active_activity(
    activity_id: str,
    payload: ActiveActivityClose,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ActivityRecord:
    """Chiusura forzata di un singolo timer altrui (es. sessione abbandonata). Solo Admin."""
    record = db.scalar(select(ActiveActivity).where(ActiveActivity.id == activity_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attività in corso non trovata.")
    record_audit_log(
        db,
        action="admin_close",
        entity="active_activity",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"activity_id": record.id, "employee_id": record.employee_id, "mapping_id": record.mapping_id, "started_at": record.started_at.isoformat()},
    )
    return _finalize_active_activity(db, record, payload)


@router.delete("/active/admin/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_discard_active_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> None:
    """Scarto forzato di un singolo timer altrui, senza generare alcun ActivityRecord. Solo Admin."""
    record = db.scalar(select(ActiveActivity).where(ActiveActivity.id == activity_id))
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attività in corso non trovata.")
    record_audit_log(
        db,
        action="admin_discard",
        entity="active_activity",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"activity_id": record.id, "employee_id": record.employee_id, "mapping_id": record.mapping_id, "started_at": record.started_at.isoformat()},
    )
    db.delete(record)
    db.commit()


# ── Operazioni su una singola attività (indirizzata per id) ───────────────────

@router.get("/active/{activity_id}", response_model=ActiveActivityRead)
def get_active_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActiveActivityRead:
    """Ricostruisce lo stato di un singolo timer e funge da heartbeat."""
    record = _get_owned_activity(db, employee.id, activity_id)
    record.last_heartbeat_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(record)
    return _read(db, record)


@router.patch("/active/{activity_id}", response_model=ActiveActivityRead)
def update_active_activity(
    activity_id: str,
    payload: ActiveActivityUpdate,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActiveActivityRead:
    """Aggiorna i campi del form in corso (draft) di un timer e funge da heartbeat."""
    record = _get_owned_activity(db, employee.id, activity_id)

    # Area e immobile vengono scelti allo start e, come i campi obbligatori,
    # sono immutabili a timer avviato: rifiutati se il valore cambia.
    if payload.operational_area_id is not None and payload.operational_area_id != record.operational_area_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="L'area operativa non è modificabile a timer avviato.",
        )
    if payload.building is not None and (payload.building.strip().upper() or None) != record.building:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="L'immobile non è modificabile a timer avviato.",
        )
    if payload.field_values is not None:
        # I campi obbligatori identificano il timer (conflict_key) e sono
        # immutabili dopo lo start.
        required = required_fields(db, record.mapping_id)
        changed = [
            label
            for key, label in sorted(required.items())
            if key in payload.field_values
            and normalize_field_value(payload.field_values[key])
            != normalize_field_value((record.field_values or {}).get(key))
        ]
        if changed:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"I campi obbligatori non sono modificabili a timer avviato: {', '.join(changed)}.",
            )
        record.field_values = {**(record.field_values or {}), **payload.field_values}
    record.last_heartbeat_at = datetime.now(timezone.utc)

    db.commit()
    db.refresh(record)
    return _read(db, record)


@router.post("/active/{activity_id}/pause", response_model=ActiveActivityRead)
def pause_active_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActiveActivityRead:
    """Mette in pausa un singolo timer (le altre attività proseguono)."""
    record = _get_owned_activity(db, employee.id, activity_id)
    now = datetime.now(timezone.utc)
    if record.paused_at is None:
        record.paused_at = now
    record.last_heartbeat_at = now
    db.commit()
    db.refresh(record)
    return _read(db, record, now)


@router.post("/active/{activity_id}/resume", response_model=ActiveActivityRead)
def resume_active_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActiveActivityRead:
    """Riprende un singolo timer in pausa."""
    record = _get_owned_activity(db, employee.id, activity_id)
    now = datetime.now(timezone.utc)
    if record.paused_at is not None:
        record.pause_seconds += int((now - _as_utc(record.paused_at)).total_seconds())
        record.paused_at = None
    record.last_heartbeat_at = now
    db.commit()
    db.refresh(record)
    return _read(db, record, now)


@router.post("/active/{activity_id}/close", response_model=ActivityRecordRead, status_code=status.HTTP_201_CREATED)
def close_active_activity(
    activity_id: str,
    payload: ActiveActivityClose,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> ActivityRecord:
    """Chiude un singolo timer e lo trasforma nell'ActivityRecord definitivo (stesso schema di POST /activity-records)."""
    record = _get_owned_activity(db, employee.id, activity_id)
    record_audit_log(
        db,
        action="close",
        entity="active_activity",
        actor_name=employee.full_name,
        detail={"activity_id": record.id, "employee_id": employee.id, "mapping_id": record.mapping_id, "started_at": record.started_at.isoformat()},
    )
    return _finalize_active_activity(db, record, payload)


@router.delete("/active/{activity_id}", status_code=status.HTTP_204_NO_CONTENT)
def discard_active_activity(
    activity_id: str,
    db: Session = Depends(get_db),
    employee: Employee = Depends(get_current_local_employee),
) -> None:
    """Abbandona un singolo timer senza generare alcun ActivityRecord."""
    record = _get_owned_activity(db, employee.id, activity_id)
    record_audit_log(
        db,
        action="discard",
        entity="active_activity",
        actor_name=employee.full_name,
        detail={"activity_id": record.id, "employee_id": employee.id, "mapping_id": record.mapping_id, "started_at": record.started_at.isoformat()},
    )
    db.delete(record)
    db.commit()


# ── Admin endpoints (portal JWT) ──────────────────────────────────────────────

def _build_admin_read(
    record: ActivityRecord,
    employee_map: dict[str, str],
    mapping_map: dict[str, tuple[str | None, str | None, str | None]],
    area_map: dict[str, str],
) -> ActivityRecordAdminRead:
    mapping_desc, item_name, jupiter_desc = mapping_map.get(record.mapping_id, (None, None, None))
    area_name = area_map.get(record.operational_area_id or "", None) if record.operational_area_id else None
    return ActivityRecordAdminRead(
        id=record.id,
        employee_id=record.employee_id,
        employee_name=employee_map.get(record.employee_id),
        mapping_id=record.mapping_id,
        mapping_description=mapping_desc,
        infinity_item_name=item_name,
        jupiter_description=jupiter_desc,
        operational_area_id=record.operational_area_id,
        operational_area_name=area_name,
        building=record.building,
        started_at=record.started_at,
        ended_at=record.ended_at,
        duration_seconds=record.duration_seconds,
        field_values=record.field_values,
        created_at=record.created_at,
    )


def _load_lookup_maps(
    db: Session,
    records: list[ActivityRecord],
) -> tuple[dict[str, str], dict[str, tuple[str | None, str | None, str | None]], dict[str, str]]:
    emp_ids = {r.employee_id for r in records}
    map_ids = {r.mapping_id for r in records}
    area_ids = {r.operational_area_id for r in records if r.operational_area_id}

    employees = db.scalars(select(Employee).where(Employee.id.in_(emp_ids))).all() if emp_ids else []
    mappings = (
        db.scalars(
            select(InfinityBillingCustomerSupplierMap)
            .where(InfinityBillingCustomerSupplierMap.id.in_(map_ids))
        ).all()
        if map_ids
        else []
    )

    employee_map = {e.id: e.full_name for e in employees}
    mapping_map: dict[str, tuple[str | None, str | None, str | None]] = {
        m.id: (m.customer_supplier_description, m.infinity_billing_item_name, m.jupiter_description) for m in mappings
    }

    # L'area del record è scelta dall'operatore a ogni avvio e può non
    # coincidere con quella dell'incrocio: risolvi i nomi direttamente.
    areas = db.scalars(select(OperationalArea).where(OperationalArea.id.in_(area_ids))).all() if area_ids else []
    area_map: dict[str, str] = {a.id: a.name for a in areas}

    return employee_map, mapping_map, area_map


@router.get("/admin", response_model=list[ActivityRecordAdminRead])
def admin_list_activity_records(
    employee_id: str | None = Query(default=None),
    mapping_id: str | None = Query(default=None),
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    limit: int = Query(default=200, ge=1, le=2000),
    db: Session = Depends(get_db),
    _: User = Depends(require_timesheets_access),
) -> list[ActivityRecordAdminRead]:
    stmt = select(ActivityRecord).order_by(ActivityRecord.started_at.desc()).limit(limit)
    if employee_id:
        stmt = stmt.where(ActivityRecord.employee_id == employee_id)
    if mapping_id:
        stmt = stmt.where(ActivityRecord.mapping_id == mapping_id)
    if start_date:
        stmt = stmt.where(func.date(ActivityRecord.started_at) >= start_date)
    if end_date:
        stmt = stmt.where(func.date(ActivityRecord.started_at) <= end_date)

    records = list(db.scalars(stmt).all())
    if not records:
        return []

    emp_map, map_map, area_map = _load_lookup_maps(db, records)
    return [_build_admin_read(r, emp_map, map_map, area_map) for r in records]


@router.patch("/admin/{record_id}", response_model=ActivityRecordAdminRead)
def admin_update_activity_record(
    record_id: str,
    payload: ActivityRecordUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> ActivityRecordAdminRead:
    """Modifica una giornata rendicontata. Solo Admin.

    Aggiorna solo i campi effettivamente inviati dal client (exclude_unset) e
    valida la coerenza degli orari prima di salvare.
    """
    record = db.get(ActivityRecord, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attività non trovata.")

    updates = payload.model_dump(exclude_unset=True)
    for key, value in updates.items():
        setattr(record, key, value)

    if _as_utc(record.ended_at) <= _as_utc(record.started_at):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="L'orario di fine deve essere successivo a quello di inizio.",
        )
    if record.duration_seconds < 1:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La durata deve essere di almeno un secondo.",
        )

    record_audit_log(
        db,
        action="admin_update",
        entity="activity_record",
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
            detail="Esiste già una giornata con la stessa matricola, incrocio e orario di inizio.",
        ) from exc
    db.refresh(record)

    emp_map, map_map, area_map = _load_lookup_maps(db, [record])
    return _build_admin_read(record, emp_map, map_map, area_map)


@router.delete("/admin/{record_id}", status_code=status.HTTP_204_NO_CONTENT)
def admin_delete_activity_record(
    record_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> None:
    """Elimina definitivamente una giornata rendicontata. Solo Admin, senza passare dal DB."""
    record = db.get(ActivityRecord, record_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attività non trovata.")
    record_audit_log(
        db,
        action="admin_delete",
        entity="activity_record",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"id": record.id, "employee_id": record.employee_id, "mapping_id": record.mapping_id, "started_at": record.started_at.isoformat()},
    )
    db.delete(record)
    db.commit()


@router.get("/admin/stats", response_model=ActivityRecordStatsResponse)
def admin_activity_stats(
    start_date: date | None = Query(default=None),
    end_date: date | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_timesheets_access),
) -> ActivityRecordStatsResponse:
    def _base(stmt):
        if start_date:
            stmt = stmt.where(func.date(ActivityRecord.started_at) >= start_date)
        if end_date:
            stmt = stmt.where(func.date(ActivityRecord.started_at) <= end_date)
        return stmt

    totals = db.execute(
        _base(
            select(
                func.count(ActivityRecord.id).label("total_count"),
                func.coalesce(func.sum(ActivityRecord.duration_seconds), 0).label("total_seconds"),
                func.count(func.distinct(ActivityRecord.employee_id)).label("employee_count"),
                func.count(func.distinct(ActivityRecord.mapping_id)).label("mapping_count"),
            )
        )
    ).one()

    by_mapping_rows = db.execute(
        _base(
            select(
                ActivityRecord.mapping_id,
                func.count(ActivityRecord.id).label("activity_count"),
                func.count(func.distinct(ActivityRecord.employee_id)).label("employee_count"),
                func.coalesce(func.sum(ActivityRecord.duration_seconds), 0).label("total_seconds"),
            )
        )
        .group_by(ActivityRecord.mapping_id)
        .order_by(func.sum(ActivityRecord.duration_seconds).desc())
    ).all()

    by_employee_rows = db.execute(
        _base(
            select(
                ActivityRecord.employee_id,
                func.count(ActivityRecord.id).label("activity_count"),
                func.count(func.distinct(ActivityRecord.mapping_id)).label("mapping_count"),
                func.coalesce(func.sum(ActivityRecord.duration_seconds), 0).label("total_seconds"),
            )
        )
        .group_by(ActivityRecord.employee_id)
        .order_by(func.sum(ActivityRecord.duration_seconds).desc())
    ).all()

    by_location_rows = db.execute(
        _base(
            select(
                ActivityRecord.operational_area_id,
                ActivityRecord.building,
                ActivityRecord.mapping_id,
                func.count(ActivityRecord.id).label("activity_count"),
                func.count(func.distinct(ActivityRecord.employee_id)).label("employee_count"),
                func.coalesce(func.sum(ActivityRecord.duration_seconds), 0).label("total_seconds"),
            )
        )
        .group_by(ActivityRecord.operational_area_id, ActivityRecord.building, ActivityRecord.mapping_id)
        .order_by(func.sum(ActivityRecord.duration_seconds).desc())
    ).all()

    # Resolve names
    map_ids = {r.mapping_id for r in by_mapping_rows} | {r.mapping_id for r in by_location_rows}
    emp_ids = {r.employee_id for r in by_employee_rows}
    area_ids = {r.operational_area_id for r in by_location_rows if r.operational_area_id}

    mappings = (
        db.scalars(select(InfinityBillingCustomerSupplierMap).where(InfinityBillingCustomerSupplierMap.id.in_(map_ids))).all()
        if map_ids else []
    )
    employees = (
        db.scalars(select(Employee).where(Employee.id.in_(emp_ids))).all()
        if emp_ids else []
    )
    areas = (
        db.scalars(select(OperationalArea).where(OperationalArea.id.in_(area_ids))).all()
        if area_ids else []
    )
    map_info: dict[str, tuple[str | None, str | None, str | None]] = {
        m.id: (m.customer_supplier_description, m.infinity_billing_item_name, m.jupiter_description) for m in mappings
    }
    mappings_by_id = {m.id: m for m in mappings}
    emp_names: dict[str, str] = {e.id: e.full_name for e in employees}
    area_names: dict[str, str] = {a.id: a.name for a in areas}

    by_mapping = [
        ActivityMappingHoursRow(
            mapping_id=r.mapping_id,
            mapping_description=map_info.get(r.mapping_id, (None, None, None))[0],
            infinity_item_name=map_info.get(r.mapping_id, (None, None, None))[1],
            jupiter_description=map_info.get(r.mapping_id, (None, None, None))[2],
            activity_count=r.activity_count,
            employee_count=r.employee_count,
            total_seconds=r.total_seconds,
            total_hours=round(r.total_seconds / 3600, 2),
        )
        for r in by_mapping_rows
    ]
    by_employee = [
        ActivityEmployeeHoursRow(
            employee_id=r.employee_id,
            employee_name=emp_names.get(r.employee_id),
            activity_count=r.activity_count,
            mapping_count=r.mapping_count,
            total_seconds=r.total_seconds,
            total_hours=round(r.total_seconds / 3600, 2),
        )
        for r in by_employee_rows
    ]
    by_location = [
        ActivityLocationHoursRow(
            operational_area_id=r.operational_area_id,
            operational_area_name=area_names.get(r.operational_area_id) if r.operational_area_id else None,
            building=r.building,
            mapping_id=r.mapping_id,
            customer_code=(mappings_by_id[r.mapping_id].customer_supplier_code if r.mapping_id in mappings_by_id else None),
            customer_name=(mappings_by_id[r.mapping_id].customer_supplier_description if r.mapping_id in mappings_by_id else None),
            activity_count=r.activity_count,
            employee_count=r.employee_count,
            total_seconds=r.total_seconds,
            total_hours=round(r.total_seconds / 3600, 2),
        )
        for r in by_location_rows
    ]

    total_seconds = int(totals.total_seconds)
    return ActivityRecordStatsResponse(
        total_count=totals.total_count,
        total_seconds=total_seconds,
        total_hours=round(total_seconds / 3600, 2),
        employee_count=totals.employee_count,
        mapping_count=totals.mapping_count,
        by_mapping=by_mapping,
        by_employee=by_employee,
        by_location=by_location,
    )

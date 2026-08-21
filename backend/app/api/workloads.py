from datetime import date, datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.teams import _serialize_team_daily_note
from app.db import get_db
from app.models import Team, TeamDailyNote, User
from app.schemas import (
    GesapWorkloadImportCreate,
    TeamDailyNoteRead,
    TeamDailyNoteUpsert,
    WorkloadCustomerSupplierRead,
    WorkloadTableRow,
    WorkloadTeamEntryRead,
)
from app.services.absence_permissions import get_linked_tms_employee
from app.services.audit import record_audit_log
from app.services.gesap import fetch_prenotazioni
from app.services.workload_gesap import booking_date, booking_id, is_cancelled_booking, is_gesap_row, protect_gesap_rows, row_from_booking
from app.services.workload_rows import diff_and_stamp_rows
from app.services.portal_auth import build_auth_user_read
from app.services.security import get_current_user
from app.services.stocktonoli import fetch_customer_suppliers

router = APIRouter(prefix="/workloads", tags=["workloads"])


def require_workloads_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth = build_auth_user_read(db, current_user)
    if not auth.can_access_workloads:
        raise HTTPException(status_code=403, detail="Accesso ai carichi non consentito.")
    return current_user


def _normalize_workload_rows(rows: list[WorkloadTableRow] | None) -> list[dict]:
    normalized: list[dict] = []
    for row in rows or []:
        item = row.model_dump(mode="json")
        item["client_supplier_code"] = (item.get("client_supplier_code") or "").strip() or None
        item["client_supplier"] = (item.get("client_supplier") or "").strip() or None
        item["notes"] = (item.get("notes") or "").strip() or None
        item["warehouse"] = (item.get("warehouse") or "").strip() or None
        if not any([
            item["client_supplier"],
            item["notes"],
            item["warehouse"],
            item["inbound_count"],
            item["outbound_count"],
            item["pallet_count"],
        ]):
            continue
        normalized.append(item)
    return normalized


def _build_workload_summary(rows: list[dict]) -> str | None:
    if not rows:
        return None
    lines: list[str] = []
    for row in rows:
        bits = []
        if row.get("client_supplier"):
            bits.append(row["client_supplier"])
        elif row.get("client_supplier_code"):
            bits.append(row["client_supplier_code"])
        bits.append(f"IN {row.get('inbound_count', 0)}")
        bits.append(f"OUT {row.get('outbound_count', 0)}")
        bits.append(f"PLT {row.get('pallet_count', 0)}")
        if row.get("warehouse"):
            bits.append(f"MAG {row['warehouse']}")
        if row.get("notes"):
            bits.append(row["notes"].replace("\n", " ").strip())
        lines.append(" | ".join(bits))
    return "\n".join(lines)


def _fetch_gesap_or_502(work_date: date) -> dict:
    try:
        return fetch_prenotazioni(work_date)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Servizio Gesap non raggiungibile.",
        ) from exc


def _all_daily_notes(db: Session) -> list[TeamDailyNote]:
    return list(db.scalars(select(TeamDailyNote).options(selectinload(TeamDailyNote.owner_employee))).all())


def _find_imported_row(notes: list[TeamDailyNote], gesap_booking_id: str) -> tuple[TeamDailyNote, dict] | None:
    for note in notes:
        for row in note.table_rows or []:
            if isinstance(row, dict) and str(row.get("gesap_booking_id") or "") == gesap_booking_id:
                return note, row
    return None


def _set_note_rows(note: TeamDailyNote, rows: list[dict]) -> None:
    note.table_rows = rows
    note.workload = _build_workload_summary(rows)


def _list_accessible_teams(db: Session, current_user: User) -> list[Team]:
    del current_user
    return db.scalars(
        select(Team)
        .options(selectinload(Team.team_leader), selectinload(Team.workload_owner))
        .order_by(Team.name.asc())
    ).all()


def _load_accessible_team(team_id: str, db: Session, current_user: User) -> Team:
    for team in _list_accessible_teams(db, current_user):
        if team.id == team_id:
            return team
    raise HTTPException(status_code=404, detail="Squadra non trovata.")


@router.get("/customer-suppliers", response_model=list[WorkloadCustomerSupplierRead])
def list_customer_suppliers(
    current_user: User = Depends(get_current_user),
) -> list[WorkloadCustomerSupplierRead]:
    del current_user
    return [
        WorkloadCustomerSupplierRead(code=item.code, description=item.description)
        for item in fetch_customer_suppliers()
    ]


@router.get("/teams", response_model=list[WorkloadTeamEntryRead])
def list_workload_teams(
    work_date: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workloads_access),
) -> list[WorkloadTeamEntryRead]:
    teams = _list_accessible_teams(db, current_user)
    if not teams:
        return []

    team_ids = [team.id for team in teams]
    notes = db.scalars(
        select(TeamDailyNote)
        .where(TeamDailyNote.work_date == work_date, TeamDailyNote.team_id.in_(team_ids))
        .options(selectinload(TeamDailyNote.owner_employee))
    ).all()
    note_by_team_id = {note.team_id: note for note in notes}

    return [
        WorkloadTeamEntryRead(
            team_id=team.id,
            team_name=team.name,
            team_icon=team.icon,
            team_color=team.color,
            team_leader_employee_name=team.team_leader.full_name if team.team_leader else None,
            workload_owner_employee_name=team.workload_owner.full_name if team.workload_owner else None,
            work_date=work_date,
            workload=note_by_team_id.get(team.id).workload if note_by_team_id.get(team.id) else None,
            rows=note_by_team_id.get(team.id).table_rows if note_by_team_id.get(team.id) else [],
            owner_employee_id=note_by_team_id.get(team.id).owner_employee_id if note_by_team_id.get(team.id) else None,
            owner_employee_name=note_by_team_id.get(team.id).owner_employee_name if note_by_team_id.get(team.id) else None,
            updated_at=note_by_team_id.get(team.id).updated_at if note_by_team_id.get(team.id) else None,
        )
        for team in teams
    ]


@router.put("/teams/{team_id}/daily-notes/{work_date}", response_model=TeamDailyNoteRead)
def upsert_structured_workload(
    team_id: str,
    work_date: date,
    payload: TeamDailyNoteUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workloads_access),
) -> TeamDailyNoteRead:
    _load_accessible_team(team_id, db, current_user)

    note = db.scalar(
        select(TeamDailyNote)
        .where(TeamDailyNote.team_id == team_id, TeamDailyNote.work_date == work_date)
        .options(selectinload(TeamDailyNote.owner_employee))
    )
    if note is None:
        note = TeamDailyNote(team_id=team_id, work_date=work_date)
        db.add(note)

    linked_employee = get_linked_tms_employee(db, current_user)
    actor_label = linked_employee.full_name if linked_employee else current_user.username
    existing_rows = [dict(row) for row in (note.table_rows or []) if isinstance(row, dict)]
    rows = protect_gesap_rows(existing_rows, _normalize_workload_rows(payload.rows))
    row_events = diff_and_stamp_rows(existing_rows, rows, actor_label)
    _set_note_rows(note, rows)
    note.owner_employee_id = linked_employee.id if linked_employee else None

    record_audit_log(
        db,
        action="upsert",
        entity="team_daily_note",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"team_id": team_id, "work_date": work_date.isoformat(), "rows": len(rows)},
    )
    for event in row_events:
        record_audit_log(
            db,
            action=event.pop("action"),
            entity="team_daily_note_row",
            actor_name=current_user.username,
            user_id=current_user.id,
            detail={"team_id": team_id, "work_date": work_date.isoformat(), **event},
        )
    db.commit()
    db.refresh(note)
    return _serialize_team_daily_note(note)


@router.post("/gesap/import")
def import_gesap_booking(
    payload: GesapWorkloadImportCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workloads_access),
) -> dict:
    team = _load_accessible_team(payload.team_id, db, current_user)
    gesap_payload = _fetch_gesap_or_502(payload.work_date)
    item = next(
        (candidate for candidate in gesap_payload.get("items", []) if booking_id(candidate) == payload.booking_id),
        None,
    )
    if item is None:
        raise HTTPException(status_code=404, detail="Prenotazione ToolTo non trovata per la data selezionata.")
    if is_cancelled_booking(item):
        raise HTTPException(status_code=409, detail="La prenotazione ToolTo è annullata e non può essere importata.")

    all_notes = _all_daily_notes(db)
    if _find_imported_row(all_notes, payload.booking_id):
        raise HTTPException(status_code=409, detail="La prenotazione ToolTo è già stata importata nei Carichi.")

    effective_date = booking_date(item, payload.work_date)
    note = next((entry for entry in all_notes if entry.team_id == team.id and entry.work_date == effective_date), None)
    if note is None:
        note = TeamDailyNote(team_id=team.id, work_date=effective_date)
        db.add(note)

    linked_employee = get_linked_tms_employee(db, current_user)
    actor_label = linked_employee.full_name if linked_employee else current_user.username
    existing_rows = [dict(row) for row in (note.table_rows or []) if isinstance(row, dict)]
    rows = [*existing_rows, row_from_booking(item, effective_date)]
    row_events = diff_and_stamp_rows(existing_rows, rows, actor_label)
    _set_note_rows(note, rows)
    note.owner_employee_id = linked_employee.id if linked_employee else None

    record_audit_log(
        db,
        action="import_gesap_booking",
        entity="team_daily_note_row",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "team_id": team.id,
            "work_date": effective_date.isoformat(),
            "gesap_booking_id": payload.booking_id,
            "row_id": row_events[-1].get("row_id") if row_events else None,
        },
    )
    db.commit()
    return {
        "booking_id": payload.booking_id,
        "team_id": team.id,
        "team_name": team.name,
        "work_date": effective_date.isoformat(),
    }


@router.post("/gesap/sync")
def sync_gesap_bookings(
    work_date: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_workloads_access),
) -> dict:
    gesap_payload = _fetch_gesap_or_502(work_date)
    current_items = {
        booking_id(item): item
        for item in gesap_payload.get("items", [])
        if isinstance(item, dict) and booking_id(item)
    }
    notes = _all_daily_notes(db)
    original_rows = {
        id(note): [dict(row) for row in (note.table_rows or []) if isinstance(row, dict)]
        for note in notes
    }
    working_rows = {note_id: [dict(row) for row in rows] for note_id, rows in original_rows.items()}
    notes_by_key = {(note.team_id, note.work_date): note for note in notes}
    changed_note_ids: set[int] = set()
    deleted = 0
    updated = 0
    moved = 0

    def destination_note(team_id: str, target_date: date) -> TeamDailyNote:
        key = (team_id, target_date)
        note = notes_by_key.get(key)
        if note is None:
            note = TeamDailyNote(team_id=team_id, work_date=target_date)
            db.add(note)
            notes.append(note)
            notes_by_key[key] = note
            original_rows[id(note)] = []
            working_rows[id(note)] = []
        return note

    # La scansione parte da uno snapshot: le righe spostate non vengono elaborate due volte.
    imported_snapshot = [
        (note, dict(row))
        for note in list(notes)
        for row in original_rows[id(note)]
        if is_gesap_row(row)
    ]
    for source_note, existing in imported_snapshot:
        source_id = id(source_note)
        source_booking_id = str(existing.get("gesap_booking_id") or "")
        item = current_items.get(source_booking_id)
        source_date = str(existing.get("gesap_booking_date") or source_note.work_date.isoformat())

        if item is None:
            if source_date == work_date.isoformat():
                working_rows[source_id] = [
                    row for row in working_rows[source_id]
                    if str(row.get("gesap_booking_id") or "") != source_booking_id
                ]
                changed_note_ids.add(source_id)
                deleted += 1
            continue

        if is_cancelled_booking(item):
            working_rows[source_id] = [
                row for row in working_rows[source_id]
                if str(row.get("gesap_booking_id") or "") != source_booking_id
            ]
            changed_note_ids.add(source_id)
            deleted += 1
            continue

        target_date = booking_date(item, work_date)
        target_note = destination_note(source_note.team_id, target_date)
        next_row = row_from_booking(item, target_date, existing)
        if next_row != existing:
            next_row["last_modified_by"] = "Sincronizzazione ToolTo"
            next_row["last_modified_at"] = datetime.now(timezone.utc).isoformat()
            updated += 1
        if target_note is source_note:
            if next_row != existing:
                working_rows[source_id] = [
                    next_row if str(row.get("gesap_booking_id") or "") == source_booking_id else row
                    for row in working_rows[source_id]
                ]
                changed_note_ids.add(source_id)
        else:
            working_rows[source_id] = [
                row for row in working_rows[source_id]
                if str(row.get("gesap_booking_id") or "") != source_booking_id
            ]
            working_rows[id(target_note)].append(next_row)
            changed_note_ids.add(source_id)
            changed_note_ids.add(id(target_note))
            moved += 1

    for note in notes:
        note_id = id(note)
        if note_id in changed_note_ids:
            _set_note_rows(note, working_rows[note_id])

    locations: dict[str, tuple[str, str]] = {}
    team_names = {team.id: team.name for team in db.scalars(select(Team)).all()}
    for note in notes:
        for row in working_rows[id(note)]:
            if is_gesap_row(row):
                locations[str(row["gesap_booking_id"])] = (note.team_id, team_names.get(note.team_id, note.team_id))

    if changed_note_ids:
        record_audit_log(
            db,
            action="sync_gesap_bookings",
            entity="team_daily_note_row",
            actor_name=current_user.username,
            user_id=current_user.id,
            detail={"work_date": work_date.isoformat(), "updated": updated, "moved": moved, "deleted": deleted},
        )
        db.commit()

    items = []
    for item in gesap_payload.get("items", []):
        item_copy = dict(item)
        location = locations.get(booking_id(item))
        item_copy["workload_imported"] = location is not None
        item_copy["workload_team_id"] = location[0] if location else None
        item_copy["workload_team_name"] = location[1] if location else None
        items.append(item_copy)
    return {**gesap_payload, "items": items, "sync": {"updated": updated, "moved": moved, "deleted": deleted}}

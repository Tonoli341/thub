from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.teams import _serialize_team_daily_note
from app.db import get_db
from app.models import Team, TeamDailyNote, User
from app.schemas import (
    TeamDailyNoteRead,
    TeamDailyNoteUpsert,
    WorkloadCustomerSupplierRead,
    WorkloadTableRow,
    WorkloadTeamEntryRead,
)
from app.services.absence_permissions import get_linked_tms_employee
from app.services.audit import record_audit_log
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
    rows = _normalize_workload_rows(payload.rows)
    existing_rows = [dict(row) for row in (note.table_rows or []) if isinstance(row, dict)]
    row_events = diff_and_stamp_rows(existing_rows, rows, actor_label)
    note.table_rows = rows
    note.workload = _build_workload_summary(rows)
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

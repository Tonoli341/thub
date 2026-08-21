from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_organization_access, require_organization_or_planner_access
from app.db import get_db
from app.services.audit import record_audit_log
from app.models import Employee, Team, TeamDailyNote, TeamMember, User
from app.schemas import TeamCreate, TeamDailyNoteRead, TeamDailyNoteUpsert, TeamMemberAdd, TeamMemberSummary, TeamRead, TeamUpdate
from app.services.absence_permissions import get_linked_tms_employee
from app.services.security import get_current_user
from app.services.workload_rows import diff_and_stamp_rows

router = APIRouter(prefix="/teams", tags=["teams"])


def _normalize_function_label(value: str | None) -> str:
    return (value or "").strip().casefold()


def _team_to_read(team: Team) -> TeamRead:
    members = sorted(
        [
            TeamMemberSummary(employee_id=member.employee_id, employee_name=member.employee.full_name)
            for member in team.members
        ],
        key=lambda member: member.employee_name,
    )
    return TeamRead(
        id=team.id,
        name=team.name,
        icon=team.icon,
        color=team.color,
        organization_function=team.organization_function,
        organization_department=team.organization_department,
        team_leader_employee_id=team.team_leader_employee_id,
        team_leader_employee_name=team.team_leader.full_name if team.team_leader else None,
        team_leader_manager_employee_id=team.team_leader.manager_employee_id if team.team_leader else None,
        team_leader_2_employee_id=team.team_leader_2_employee_id,
        team_leader_2_employee_name=team.team_leader_2.full_name if team.team_leader_2 else None,
        reports_to_employee_id=team.reports_to_employee_id,
        reports_to_employee_name=team.reports_to_employee.full_name if team.reports_to_employee else None,
        workload_owner_employee_id=team.workload_owner_employee_id,
        workload_owner_employee_name=team.workload_owner.full_name if team.workload_owner else None,
        operational_reporting_owner_employee_id=team.operational_reporting_owner_employee_id,
        operational_reporting_owner_employee_name=(
            team.operational_reporting_owner.full_name if team.operational_reporting_owner else None
        ),
        operational_reporting_notifications_enabled=bool(team.operational_reporting_notifications_enabled),
        operational_reporting_email_enabled=bool(team.operational_reporting_email_enabled),
        created_at=team.created_at,
        updated_at=team.updated_at,
        members=members,
    )


def _load_team(team_id: str, db: Session) -> Team:
    team = db.scalar(
        select(Team)
        .where(Team.id == team_id)
        .options(
            selectinload(Team.members).selectinload(TeamMember.employee),
            selectinload(Team.team_leader),
            selectinload(Team.team_leader_2),
            selectinload(Team.reports_to_employee),
            selectinload(Team.workload_owner),
            selectinload(Team.operational_reporting_owner),
        )
    )
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    return team


def _serialize_team_daily_note(note: TeamDailyNote) -> TeamDailyNoteRead:
    return TeamDailyNoteRead(
        id=note.id,
        team_id=note.team_id,
        work_date=note.work_date,
        workload=note.workload,
        rows=note.table_rows or [],
        owner_employee_id=note.owner_employee_id,
        owner_employee_name=note.owner_employee_name,
        updated_at=note.updated_at,
    )


def _resolve_team_leader_id(team: Team, employee_id: str | None, db: Session) -> str | None:
    if employee_id is None:
        return None
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(404, "Dipendente non trovato")
    if not any(member.employee_id == employee_id for member in team.members):
        raise HTTPException(400, "Il team leader deve essere un membro della squadra")
    return employee_id



def _resolve_reports_to_employee_id(
    team: Team,
    employee_id: str | None,
    db: Session,
    team_leader_employee_id: str | None,
) -> str | None:
    if employee_id is None:
        return None
    if team_leader_employee_id is None:
        raise HTTPException(400, "Definisci prima il team leader")
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(404, "Dipendente non trovato")
    if employee_id == team_leader_employee_id:
        raise HTTPException(400, "La risorsa a cui riporta il team leader deve essere diversa dal team leader")
    if any(member.employee_id == employee_id for member in team.members):
        raise HTTPException(400, "La risorsa a cui riporta il team leader deve essere esterna al team")
    reports_to_team = db.scalar(select(Team).join(TeamMember).where(TeamMember.employee_id == employee_id))
    if reports_to_team is None:
        raise HTTPException(400, "La risorsa a cui riporta il team leader deve appartenere a un altra squadra")
    if _normalize_function_label(reports_to_team.organization_function) != _normalize_function_label(team.organization_function):
        raise HTTPException(400, "La risorsa a cui riporta il team leader deve appartenere alla stessa funzione")
    return employee_id


@router.get("", response_model=list[TeamRead], dependencies=[Depends(require_organization_or_planner_access)])
def list_teams(db: Session = Depends(get_db)):
    teams = db.scalars(
        select(Team)
        .options(
            selectinload(Team.members).selectinload(TeamMember.employee),
            selectinload(Team.team_leader),
            selectinload(Team.team_leader_2),
            selectinload(Team.reports_to_employee),
            selectinload(Team.workload_owner),
            selectinload(Team.operational_reporting_owner),
        )
        .order_by(Team.name)
    ).all()
    return [_team_to_read(team) for team in teams]


@router.post("", response_model=TeamRead, status_code=201, dependencies=[Depends(require_organization_access)])
def create_team(payload: TeamCreate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    if db.scalar(select(Team).where(Team.name == payload.name)):
        raise HTTPException(409, "Nome squadra già in uso")
    team = Team(
        name=payload.name,
        icon=payload.icon,
        color=payload.color,
        organization_function=(payload.organization_function or "").strip() or None,
        organization_department=(payload.organization_department or "").strip() or None,
    )
    db.add(team)
    record_audit_log(db, action="create", entity="team", actor_name=current_user.username, user_id=current_user.id, detail=payload.model_dump(mode="json"))
    db.commit()
    return _team_to_read(_load_team(team.id, db))


@router.put("/{team_id}", response_model=TeamRead, dependencies=[Depends(require_organization_access)])
def update_team(team_id: str, payload: TeamUpdate, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    team = _load_team(team_id, db)
    if payload.name is not None:
        if db.scalar(select(Team).where(Team.name == payload.name, Team.id != team_id)):
            raise HTTPException(409, "Nome squadra già in uso")
        team.name = payload.name
    if payload.icon is not None:
        team.icon = payload.icon
    if payload.color is not None:
        team.color = payload.color
    if "organization_function" in payload.model_fields_set:
        team.organization_function = (payload.organization_function or "").strip() or None
    if "organization_department" in payload.model_fields_set:
        team.organization_department = (payload.organization_department or "").strip() or None
    if "team_leader_employee_id" in payload.model_fields_set:
        team.team_leader_employee_id = _resolve_team_leader_id(team, payload.team_leader_employee_id, db)
        if team.team_leader_employee_id is None or team.reports_to_employee_id == team.team_leader_employee_id:
            team.reports_to_employee_id = None
    if "team_leader_2_employee_id" in payload.model_fields_set:
        team.team_leader_2_employee_id = _resolve_team_leader_id(team, payload.team_leader_2_employee_id, db)
    if "workload_owner_employee_id" in payload.model_fields_set:
        if payload.workload_owner_employee_id is not None and db.get(Employee, payload.workload_owner_employee_id) is None:
            raise HTTPException(404, "Dipendente non trovato")
        team.workload_owner_employee_id = payload.workload_owner_employee_id
    if "operational_reporting_owner_employee_id" in payload.model_fields_set:
        if (
            payload.operational_reporting_owner_employee_id is not None
            and db.get(Employee, payload.operational_reporting_owner_employee_id) is None
        ):
            raise HTTPException(404, "Dipendente non trovato")
        team.operational_reporting_owner_employee_id = payload.operational_reporting_owner_employee_id
    if "operational_reporting_notifications_enabled" in payload.model_fields_set:
        team.operational_reporting_notifications_enabled = bool(payload.operational_reporting_notifications_enabled)
    if "operational_reporting_email_enabled" in payload.model_fields_set:
        team.operational_reporting_email_enabled = bool(payload.operational_reporting_email_enabled)
    if "reports_to_employee_id" in payload.model_fields_set:
        team.reports_to_employee_id = _resolve_reports_to_employee_id(
            team,
            payload.reports_to_employee_id,
            db,
            team.team_leader_employee_id,
        )
    elif team.reports_to_employee_id is not None:
        try:
            team.reports_to_employee_id = _resolve_reports_to_employee_id(
                team,
                team.reports_to_employee_id,
                db,
                team.team_leader_employee_id,
            )
        except HTTPException:
            team.reports_to_employee_id = None
    record_audit_log(
        db,
        action="update",
        entity="team",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"team_id": team_id, "after": payload.model_dump(mode="json", exclude_unset=True)},
    )
    db.commit()
    return _team_to_read(_load_team(team_id, db))


@router.delete("/{team_id}", status_code=204, dependencies=[Depends(require_organization_access)])
def delete_team(team_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    team = db.scalar(select(Team).where(Team.id == team_id))
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    record_audit_log(db, action="delete", entity="team", actor_name=current_user.username, user_id=current_user.id, detail={"team_id": team_id, "name": team.name})
    db.delete(team)
    db.commit()


@router.post("/{team_id}/members", response_model=TeamRead, status_code=201, dependencies=[Depends(require_organization_access)])
def add_team_member(team_id: str, payload: TeamMemberAdd, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    team = _load_team(team_id, db)
    if not db.scalar(select(Employee).where(Employee.id == payload.employee_id)):
        raise HTTPException(404, "Dipendente non trovato")
    existing = db.scalar(select(TeamMember).where(TeamMember.employee_id == payload.employee_id))
    if existing:
        if existing.team_id == team_id:
            return _team_to_read(team)
        previous_team = db.get(Team, existing.team_id)
        if previous_team and previous_team.team_leader_employee_id == payload.employee_id:
            previous_team.team_leader_employee_id = None
        if previous_team and previous_team.team_leader_2_employee_id == payload.employee_id:
            previous_team.team_leader_2_employee_id = None
        db.delete(existing)
        db.flush()
    db.add(TeamMember(team_id=team_id, employee_id=payload.employee_id))
    record_audit_log(db, action="add_member", entity="team", actor_name=current_user.username, user_id=current_user.id, detail={"team_id": team_id, "employee_id": payload.employee_id})
    db.commit()
    return _team_to_read(_load_team(team_id, db))


@router.get("/daily-notes", response_model=list[TeamDailyNoteRead], dependencies=[Depends(require_organization_or_planner_access)])
def list_team_daily_notes(work_date: date = Query(...), db: Session = Depends(get_db)):
    notes = db.scalars(
        select(TeamDailyNote)
        .where(TeamDailyNote.work_date == work_date)
        .options(selectinload(TeamDailyNote.owner_employee))
    ).all()
    return [_serialize_team_daily_note(note) for note in notes]


@router.put(
    "/{team_id}/daily-notes/{work_date}",
    response_model=TeamDailyNoteRead,
    dependencies=[Depends(require_organization_or_planner_access)],
)
def upsert_team_daily_note(
    team_id: str,
    work_date: date,
    payload: TeamDailyNoteUpsert,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if not db.get(Team, team_id):
        raise HTTPException(404, "Squadra non trovata")
    note = db.scalar(select(TeamDailyNote).where(TeamDailyNote.team_id == team_id, TeamDailyNote.work_date == work_date))
    if note is None:
        note = TeamDailyNote(team_id=team_id, work_date=work_date)
        db.add(note)
    note.workload = (payload.workload or "").strip() or None
    existing_rows = [dict(row) for row in (note.table_rows or []) if isinstance(row, dict)]
    row_events = diff_and_stamp_rows(existing_rows, [], actor_label=None)
    note.table_rows = []
    linked_employee = get_linked_tms_employee(db, current_user)
    note.owner_employee_id = linked_employee.id if linked_employee else None
    record_audit_log(
        db,
        action="upsert",
        entity="team_daily_note",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"team_id": team_id, "work_date": work_date.isoformat(), "workload": note.workload},
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


@router.delete("/{team_id}/members/{employee_id}", status_code=204, dependencies=[Depends(require_organization_access)])
def remove_team_member(team_id: str, employee_id: str, db: Session = Depends(get_db), current_user: User = Depends(get_current_user)):
    team = db.get(Team, team_id)
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    member = db.scalar(
        select(TeamMember).where(TeamMember.team_id == team_id, TeamMember.employee_id == employee_id)
    )
    if not member:
        raise HTTPException(404, "Membro non trovato")
    if team.team_leader_employee_id == employee_id:
        team.team_leader_employee_id = None
    if team.team_leader_2_employee_id == employee_id:
        team.team_leader_2_employee_id = None
    record_audit_log(db, action="remove_member", entity="team", actor_name=current_user.username, user_id=current_user.id, detail={"team_id": team_id, "employee_id": employee_id})
    db.delete(member)
    db.commit()

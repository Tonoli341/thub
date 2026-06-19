from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin_or_hr
from app.db import get_db
from app.models import Employee, Team, TeamMember
from app.schemas import TeamCreate, TeamMemberAdd, TeamMemberSummary, TeamRead, TeamUpdate

router = APIRouter(prefix="/teams", tags=["teams"], dependencies=[Depends(require_admin_or_hr)])


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
        )
    )
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    return team


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


@router.get("", response_model=list[TeamRead])
def list_teams(db: Session = Depends(get_db)):
    teams = db.scalars(
        select(Team)
        .options(
            selectinload(Team.members).selectinload(TeamMember.employee),
            selectinload(Team.team_leader),
            selectinload(Team.team_leader_2),
            selectinload(Team.reports_to_employee),
        )
        .order_by(Team.name)
    ).all()
    return [_team_to_read(team) for team in teams]


@router.post("", response_model=TeamRead, status_code=201)
def create_team(payload: TeamCreate, db: Session = Depends(get_db)):
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
    db.commit()
    return _team_to_read(_load_team(team.id, db))


@router.put("/{team_id}", response_model=TeamRead)
def update_team(team_id: str, payload: TeamUpdate, db: Session = Depends(get_db)):
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
    db.commit()
    return _team_to_read(_load_team(team_id, db))


@router.delete("/{team_id}", status_code=204)
def delete_team(team_id: str, db: Session = Depends(get_db)):
    team = db.scalar(select(Team).where(Team.id == team_id))
    if not team:
        raise HTTPException(404, "Squadra non trovata")
    db.delete(team)
    db.commit()


@router.post("/{team_id}/members", response_model=TeamRead, status_code=201)
def add_team_member(team_id: str, payload: TeamMemberAdd, db: Session = Depends(get_db)):
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
    db.commit()
    return _team_to_read(_load_team(team_id, db))


@router.delete("/{team_id}/members/{employee_id}", status_code=204)
def remove_team_member(team_id: str, employee_id: str, db: Session = Depends(get_db)):
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
    db.delete(member)
    db.commit()

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, time, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import SessionLocal
from app.models import LdapEmployee, Team, TeamMember
from app.services.audit import record_audit_log
from app.services.email import send_operational_reporting_reminder
from app.services.operational_reporting import build_reporting_gap_notifications
from app.services.timeutils import LOCAL_TZ, now_local

logger = logging.getLogger(__name__)
REMINDER_TIME = time(10, 0)


def send_due_operational_reporting_emails(
    db: Session,
    current_time: datetime | None = None,
) -> int:
    local_now = current_time or now_local()
    if local_now.time() < REMINDER_TIME:
        return 0
    work_date = local_now.date() - timedelta(days=1)

    # In produzione uvicorn usa due worker: il lock impedisce che entrambi
    # prenotino lo stesso promemoria nello stesso istante.
    teams = list(
        db.scalars(
            select(Team)
            .where(
                Team.operational_reporting_email_enabled.is_(True),
                Team.operational_reporting_owner_employee_id.is_not(None),
                or_(
                    Team.operational_reporting_last_email_date.is_(None),
                    Team.operational_reporting_last_email_date < work_date,
                ),
            )
            .options(
                selectinload(Team.members).joinedload(TeamMember.employee),
                selectinload(Team.operational_reporting_owner),
            )
            .order_by(Team.name.asc())
            .with_for_update(skip_locked=True)
        ).unique().all()
    )
    if not teams:
        return 0

    gaps = build_reporting_gap_notifications(db, teams, work_date)
    gaps_by_team = {item["team_id"]: item for item in gaps}
    teams_by_owner: dict[str, list[Team]] = defaultdict(list)
    for team in teams:
        if team.id in gaps_by_team and team.operational_reporting_owner_employee_id:
            teams_by_owner[team.operational_reporting_owner_employee_id].append(team)

    if not teams_by_owner:
        return 0
    emails = {
        employee_id: email
        for employee_id, email in db.execute(
            select(LdapEmployee.tms_employee_id, LdapEmployee.email).where(
                LdapEmployee.tms_employee_id.in_(set(teams_by_owner)),
                LdapEmployee.is_active.is_(True),
                LdapEmployee.email.is_not(None),
            )
        ).all()
        if employee_id and email
    }

    sent = 0
    for owner_id, owner_teams in teams_by_owner.items():
        email = emails.get(owner_id)
        owner = owner_teams[0].operational_reporting_owner
        if not email or owner is None:
            logger.warning(
                "Promemoria rendicontazione non inviato: email LDAP assente per owner %s",
                owner_id,
            )
            continue
        owner_gaps = [gaps_by_team[team.id] for team in owner_teams]
        if not send_operational_reporting_reminder(email, owner.full_name, owner_gaps):
            continue
        for team in owner_teams:
            team.operational_reporting_last_email_date = work_date
            record_audit_log(
                db,
                action="email_reminder_sent",
                entity="operational_reporting",
                actor_name="scheduler",
                detail={
                    "team_id": team.id,
                    "owner_employee_id": owner_id,
                    "work_date": work_date.isoformat(),
                    "missing_count": gaps_by_team[team.id]["missing_count"],
                },
            )
            sent += 1
    if sent:
        db.commit()
    return sent


def run_operational_reporting_email_reminders() -> int:
    with SessionLocal() as db:
        try:
            return send_due_operational_reporting_emails(db)
        except Exception:
            db.rollback()
            logger.exception("Errore nel promemoria email della rendicontazione operativa")
            return 0


async def operational_reporting_email_scheduler() -> None:
    while True:
        local_now = now_local()
        deadline = datetime.combine(local_now.date(), REMINDER_TIME, tzinfo=LOCAL_TZ)
        if local_now >= deadline:
            await asyncio.to_thread(run_operational_reporting_email_reminders)
            deadline += timedelta(days=1)
        await asyncio.sleep(max(1, (deadline - now_local()).total_seconds()))

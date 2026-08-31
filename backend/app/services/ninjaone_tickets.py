"""Ticket di assistenza aperti da T-Hub verso NinjaOne (POST /v2/ticketing/ticket
su un'organizzazione NinjaOne fissa, vedi settings.ninjaone_organization_id).
Salva solo lo stato all'apertura: nessun polling né webhook per lo stato live."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models import Employee, NinjaOneTicket
from app.services import ninjaone
from app.services.audit import record_audit_log
from app.services.errors import DomainError
from app.services.ninjaone import NinjaOneError

PRIORITIES = ("LOW", "NORMAL", "HIGH", "URGENT")


def list_tickets(db: Session, *, employee_id: str | None = None) -> list[NinjaOneTicket]:
    statement = select(NinjaOneTicket).options(selectinload(NinjaOneTicket.requested_by)).order_by(
        NinjaOneTicket.created_at.desc()
    )
    if employee_id is not None:
        statement = statement.where(NinjaOneTicket.requested_by_id == employee_id)
    return list(db.scalars(statement).all())


def create_ticket(
    db: Session,
    *,
    subject: str,
    description: str,
    priority: str,
    requester: Employee,
    actor_name: str | None,
    actor_user_id: str | None,
) -> NinjaOneTicket:
    if priority not in PRIORITIES:
        raise DomainError(f"Priorità non valida: {priority}.")

    try:
        response = ninjaone.create_ticket(subject=subject, description=description, priority=priority)
    except NinjaOneError as exc:
        raise DomainError(str(exc)) from exc

    ninja_ticket_id = response.get("id")
    if ninja_ticket_id is None:
        raise DomainError("NinjaOne non ha restituito l'id del ticket creato.")

    ticket = NinjaOneTicket(
        ninja_ticket_id=str(ninja_ticket_id),
        subject=subject,
        description=description,
        priority=priority,
        status=str(response.get("status") or "OPEN"),
        requested_by_id=requester.id,
    )
    db.add(ticket)
    db.flush()
    record_audit_log(
        db,
        action="create",
        entity="ninjaone_ticket",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": ticket.id, "ninja_ticket_id": ticket.ninja_ticket_id, "subject": subject},
    )
    return ticket

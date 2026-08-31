from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_linked_tms_employee
from app.db import get_db
from app.models import Employee, User
from app.ninjaone_ticket_schemas import NinjaOneTicketCreate, NinjaOneTicketRead
from app.services import ninjaone_tickets as service
from app.services.security import get_current_user

router = APIRouter(prefix="/ninjaone/tickets", tags=["ninjaone-tickets"])


def serialize_ticket(ticket) -> NinjaOneTicketRead:
    return NinjaOneTicketRead(
        id=ticket.id,
        ninja_ticket_id=ticket.ninja_ticket_id,
        subject=ticket.subject,
        description=ticket.description,
        priority=ticket.priority,
        status=ticket.status,
        requested_by_id=ticket.requested_by_id,
        requested_by_name=ticket.requested_by.full_name if ticket.requested_by else "",
        created_at=ticket.created_at.isoformat(),
    )


@router.get("", response_model=list[NinjaOneTicketRead])
def list_my_tickets(
    db: Session = Depends(get_db),
    requester: Employee = Depends(require_linked_tms_employee),
) -> list[NinjaOneTicketRead]:
    return [serialize_ticket(ticket) for ticket in service.list_tickets(db, employee_id=requester.id)]


@router.post("", response_model=NinjaOneTicketRead, status_code=201)
def create_ticket(
    payload: NinjaOneTicketCreate,
    db: Session = Depends(get_db),
    requester: Employee = Depends(require_linked_tms_employee),
    current_user: User = Depends(get_current_user),
) -> NinjaOneTicketRead:
    ticket = service.create_ticket(
        db,
        subject=payload.subject,
        description=payload.description,
        priority=payload.priority,
        requester=requester,
        actor_name=requester.full_name,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(ticket)
    return serialize_ticket(ticket)

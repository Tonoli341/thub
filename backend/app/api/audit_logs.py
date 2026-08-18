from datetime import date, datetime, time, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import Text, cast, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db import get_db
from app.models import AuditLog
from app.schemas import AuditLogListResponse, AuditLogRead

router = APIRouter(prefix="/audit-logs", tags=["audit-logs"], dependencies=[Depends(require_admin)])


@router.get("", response_model=AuditLogListResponse)
def list_audit_logs(
    entity: str | None = Query(default=None),
    action: str | None = Query(default=None),
    actor: str | None = Query(default=None, description="Ricerca parziale sull'attore"),
    search: str | None = Query(default=None, description="Ricerca nel dettaglio JSON"),
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
) -> AuditLogListResponse:
    stmt = select(AuditLog)
    if entity:
        stmt = stmt.where(AuditLog.entity == entity.strip())
    if action:
        stmt = stmt.where(AuditLog.action == action.strip())
    if actor and actor.strip():
        stmt = stmt.where(AuditLog.actor_name.ilike(f"%{actor.strip()}%"))
    if search and search.strip():
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                cast(AuditLog.detail, Text).ilike(pattern),
                AuditLog.actor_name.ilike(pattern),
                AuditLog.entity.ilike(pattern),
                AuditLog.action.ilike(pattern),
            )
        )
    if start:
        stmt = stmt.where(AuditLog.created_at >= datetime.combine(start, time.min, tzinfo=timezone.utc))
    if end:
        stmt = stmt.where(AuditLog.created_at <= datetime.combine(end, time.max, tzinfo=timezone.utc))

    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit)).all()

    return AuditLogListResponse(
        total=total,
        items=[AuditLogRead.model_validate(row) for row in rows],
    )


@router.get("/filters")
def audit_log_filters(db: Session = Depends(get_db)) -> dict:
    """Valori distinti di entity e action per popolare i filtri della pagina Audit."""
    entities = sorted(filter(None, db.scalars(select(AuditLog.entity).distinct()).all()))
    actions = sorted(filter(None, db.scalars(select(AuditLog.action).distinct()).all()))
    return {"entities": entities, "actions": actions}

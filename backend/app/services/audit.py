from sqlalchemy.orm import Session

from app.models import AuditLog


def record_audit_log(
    db: Session,
    *,
    action: str,
    entity: str,
    detail: dict,
    actor_name: str | None = None,
    user_id: str | None = None,
) -> AuditLog:
    log = AuditLog(
        user_id=user_id,
        actor_name=actor_name,
        action=action,
        entity=entity,
        detail=detail,
    )
    db.add(log)
    return log


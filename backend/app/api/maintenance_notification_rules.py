from fastapi import APIRouter, Depends, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db import get_db
from app.maintenance_asset_models import MaintenanceNotificationRule
from app.maintenance_notification_schemas import (
    MaintenanceNotificationRuleCreate,
    MaintenanceNotificationRuleRead,
    MaintenanceNotificationRuleUpdate,
)
from app.models import LdapEmployee, User
from app.services import maintenance_notification_rules as service

router = APIRouter(prefix="/maintenance", tags=["maintenance-notification-rules"])


def serialize_rule(db: Session, rule: MaintenanceNotificationRule) -> MaintenanceNotificationRuleRead:
    recipients = []
    if rule.recipient_ldap_employee_ids:
        recipients = list(
            db.scalars(select(LdapEmployee).where(LdapEmployee.id.in_(rule.recipient_ldap_employee_ids)))
        )
    labels_by_id = {r.id: (r.display_name or r.username) for r in recipients}
    return MaintenanceNotificationRuleRead(
        id=rule.id,
        asset_class_id=rule.asset_class_id,
        asset_class_label=rule.asset_class.label if rule.asset_class else None,
        site=rule.site,
        recipient_ldap_employee_ids=rule.recipient_ldap_employee_ids,
        recipient_labels=[labels_by_id.get(rid, rid) for rid in rule.recipient_ldap_employee_ids],
        is_active=rule.is_active,
    )


@router.get("/notification-rules", response_model=list[MaintenanceNotificationRuleRead])
def list_notification_rules(
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[MaintenanceNotificationRuleRead]:
    return [serialize_rule(db, rule) for rule in service.list_rules(db)]


@router.post("/notification-rules", response_model=MaintenanceNotificationRuleRead, status_code=status.HTTP_201_CREATED)
def create_notification_rule(
    payload: MaintenanceNotificationRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> MaintenanceNotificationRuleRead:
    rule = service.create_rule(
        db,
        asset_class_id=payload.asset_class_id,
        site=payload.site,
        recipient_ldap_employee_ids=payload.recipient_ldap_employee_ids,
        is_active=payload.is_active,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(rule)
    return serialize_rule(db, rule)


@router.patch("/notification-rules/{rule_id}", response_model=MaintenanceNotificationRuleRead)
def update_notification_rule(
    rule_id: str,
    payload: MaintenanceNotificationRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> MaintenanceNotificationRuleRead:
    rule = service.get_rule_or_404(db, rule_id)
    changes = payload.model_dump(exclude_unset=True)
    service.update_rule(db, rule, changes=changes, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    db.refresh(rule)
    return serialize_rule(db, rule)


@router.delete("/notification-rules/{rule_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_notification_rule(
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    rule = service.get_rule_or_404(db, rule_id)
    service.delete_rule(db, rule, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

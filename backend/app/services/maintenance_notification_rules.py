"""Configurazione dei destinatari email per le scadenze manutenzioni (§10 e
§15 del documento requisiti): una regola abbina classe di asset + sito
(entrambi opzionali: nullo = qualunque) a un elenco di LdapEmployee da
avvisare. Le regole vengono lette da
services/maintenance_deadline_reminders.py per decidere chi avvisare quando
una scadenza supera una soglia.
"""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.maintenance_asset_models import MaintenanceAsset, MaintenanceNotificationRule
from app.models import LdapEmployee
from app.services.audit import record_audit_log
from app.services.errors import DomainError


def list_rules(db: Session) -> list[MaintenanceNotificationRule]:
    statement = select(MaintenanceNotificationRule).options(
        selectinload(MaintenanceNotificationRule.asset_class)
    ).order_by(MaintenanceNotificationRule.created_at.asc())
    return list(db.scalars(statement).all())


def get_rule_or_404(db: Session, rule_id: str) -> MaintenanceNotificationRule:
    rule = db.get(MaintenanceNotificationRule, rule_id, options=[selectinload(MaintenanceNotificationRule.asset_class)])
    if rule is None:
        raise DomainError("Regola di notifica non trovata.")
    return rule


def create_rule(
    db: Session,
    *,
    asset_class_id: str | None,
    site: str | None,
    recipient_ldap_employee_ids: list[str],
    is_active: bool,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceNotificationRule:
    rule = MaintenanceNotificationRule(
        asset_class_id=asset_class_id,
        site=site,
        recipient_ldap_employee_ids=recipient_ldap_employee_ids,
        is_active=is_active,
    )
    db.add(rule)
    db.flush()
    record_audit_log(
        db,
        action="create",
        entity="maintenance_notification_rule",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": rule.id, "asset_class_id": asset_class_id, "site": site},
    )
    return rule


def update_rule(
    db: Session,
    rule: MaintenanceNotificationRule,
    *,
    changes: dict,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceNotificationRule:
    for field in ("asset_class_id", "site", "recipient_ldap_employee_ids", "is_active"):
        if field in changes:
            setattr(rule, field, changes[field])
    db.flush()
    record_audit_log(
        db,
        action="update",
        entity="maintenance_notification_rule",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": rule.id, **{k: v for k, v in changes.items() if k != "recipient_ldap_employee_ids"}},
    )
    return rule


def delete_rule(db: Session, rule: MaintenanceNotificationRule, *, actor_name: str | None, actor_user_id: str | None) -> None:
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_notification_rule",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": rule.id},
    )
    db.delete(rule)
    db.flush()


def resolve_recipients_for_asset(
    db: Session,
    asset: MaintenanceAsset,
    rules: list[MaintenanceNotificationRule] | None = None,
) -> list[LdapEmployee]:
    """Unione dei destinatari di tutte le regole attive che si applicano
    all'asset: nullo su classe o sito significa "qualunque". Il chiamante che
    itera su più asset nella stessa run (lo scheduler) deve passare `rules`
    già caricate una volta sola, per non rileggere la tabella a ogni asset."""
    if rules is None:
        rules = list_rules(db)
    ldap_employee_ids: set[str] = set()
    for rule in rules:
        if not rule.is_active:
            continue
        if rule.asset_class_id and rule.asset_class_id != asset.asset_type.asset_class_id:
            continue
        if rule.site and rule.site != asset.custom_fields.get("site"):
            continue
        ldap_employee_ids.update(rule.recipient_ldap_employee_ids)

    if not ldap_employee_ids:
        return []

    employees = db.scalars(
        select(LdapEmployee).where(
            LdapEmployee.id.in_(ldap_employee_ids),
            LdapEmployee.is_active.is_(True),
            LdapEmployee.email.is_not(None),
        )
    ).all()
    return list(employees)

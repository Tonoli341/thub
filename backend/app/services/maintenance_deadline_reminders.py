"""Promemoria email giornaliero per le scadenze manutenzioni (§10 del
documento requisiti). Stesso schema di services/operational_reporting_reminders.py:
un task asyncio nel lifespan, un orario fisso di invio, lock riga con
`skip_locked` per restare corretto anche con i due worker di produzione.

Una scadenza sopra soglia (in_scadenza/urgente/scaduta) viene notificata una
volta al giorno finché resta tale, non una volta sola al primo superamento:
è la lettura più semplice — e la più difficile da ignorare — di "email al
raggiungimento di soglie" per un dominio dove ignorare la scadenza ha un
costo reale (verifiche normative).

I destinatari vengono da MaintenanceNotificationRule (classe di asset + sito
-> LdapEmployee): senza regole configurate per un asset, nessuna email parte
— la campanella e la dashboard restano comunque attive indipendentemente.
"""

from __future__ import annotations

import asyncio
import logging
from collections import defaultdict
from datetime import datetime, time, timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import SessionLocal
from app.maintenance_asset_models import MaintenanceAsset, MaintenanceDeadline
from app.models import LdapEmployee
from app.services.audit import record_audit_log
from app.services.email import send_maintenance_deadline_reminder
from app.services.maintenance_deadlines import compute_urgency
from app.services.maintenance_notification_rules import list_rules, resolve_recipients_for_asset
from app.services.timeutils import LOCAL_TZ, now_local

logger = logging.getLogger(__name__)
REMINDER_TIME = time(8, 0)


def send_due_maintenance_deadline_emails(
    db: Session,
    current_time: datetime | None = None,
) -> int:
    local_now = current_time or now_local()
    if local_now.time() < REMINDER_TIME:
        return 0
    today = local_now.date()

    # Lock a riga con skip_locked: se i due worker di produzione partono nello
    # stesso istante, il secondo trova le righe già prese e semplicemente non
    # le rielabora — stesso meccanismo di send_due_operational_reporting_emails.
    candidates = list(
        db.scalars(
            select(MaintenanceDeadline)
            .where(
                MaintenanceDeadline.is_active.is_(True),
                or_(
                    MaintenanceDeadline.last_notice_email_date.is_(None),
                    MaintenanceDeadline.last_notice_email_date < today,
                ),
            )
            .options(selectinload(MaintenanceDeadline.asset).selectinload(MaintenanceAsset.asset_type))
            .with_for_update(skip_locked=True)
        ).all()
    )
    pending = [(d, compute_urgency(db, d, today)) for d in candidates]
    pending = [(d, urgency) for d, urgency in pending if urgency != "regolare"]
    if not pending:
        return 0

    notification_rules = list_rules(db)
    items_by_recipient: dict[str, list[dict]] = defaultdict(list)
    recipients_by_id: dict[str, LdapEmployee] = {}
    recipient_ids_by_deadline: dict[str, set[str]] = {}
    # Più scadenze possono appartenere allo stesso asset: risolvere i
    # destinatari una volta per asset invece che per scadenza evita di
    # ripetere la stessa query su LdapEmployee.
    recipients_by_asset_id: dict[str, list[LdapEmployee]] = {}

    for deadline, urgency in pending:
        if deadline.asset_id not in recipients_by_asset_id:
            recipients_by_asset_id[deadline.asset_id] = resolve_recipients_for_asset(
                db, deadline.asset, rules=notification_rules
            )
        recipients = recipients_by_asset_id[deadline.asset_id]
        if not recipients:
            continue
        recipient_ids_by_deadline[deadline.id] = {r.id for r in recipients}
        for recipient in recipients:
            recipients_by_id[recipient.id] = recipient
            items_by_recipient[recipient.id].append({
                "asset_internal_code": deadline.asset.internal_code,
                "deadline_type": deadline.deadline_type,
                "due_date": deadline.due_date,
                "urgency": urgency,
            })

    sent_deadline_ids: set[str] = set()
    for recipient_id, items in items_by_recipient.items():
        recipient = recipients_by_id[recipient_id]
        if not send_maintenance_deadline_reminder(recipient.email, recipient.display_name or recipient.username, items):
            continue
        for deadline_id, recipient_ids in recipient_ids_by_deadline.items():
            if recipient_id in recipient_ids:
                sent_deadline_ids.add(deadline_id)

    if not sent_deadline_ids:
        return 0

    for deadline, _ in pending:
        if deadline.id not in sent_deadline_ids:
            continue
        deadline.last_notice_email_date = today
        record_audit_log(
            db,
            action="email_reminder_sent",
            entity="maintenance_deadline",
            actor_name="scheduler",
            detail={"id": deadline.id, "due_date": deadline.due_date.isoformat()},
        )
    db.commit()
    return len(sent_deadline_ids)


def run_maintenance_deadline_email_reminders() -> int:
    with SessionLocal() as db:
        try:
            return send_due_maintenance_deadline_emails(db)
        except Exception:
            db.rollback()
            logger.exception("Errore nel promemoria email delle scadenze manutenzioni")
            return 0


async def maintenance_deadline_email_scheduler() -> None:
    while True:
        local_now = now_local()
        deadline_at = datetime.combine(local_now.date(), REMINDER_TIME, tzinfo=LOCAL_TZ)
        if local_now >= deadline_at:
            await asyncio.to_thread(run_maintenance_deadline_email_reminders)
            deadline_at += timedelta(days=1)
        await asyncio.sleep(max(1, (deadline_at - now_local()).total_seconds()))

"""Scadenzario del modulo Manutenzioni (§9 e §10 del documento requisiti).

La ricorrenza decorre dalla data effettiva dell'intervento, non da quella
prevista, quando `recurrence_basis` è "da_effettiva" — è la regola indicata
al punto 5.7, e produce uno slittamento progressivo se un intervento viene
fatto in ritardo. La generazione della scadenza successiva è sempre proposta
e mai applicata in automatico: il sistema calcola una data, l'utente la
conferma (o la corregge) esplicitamente in `complete_deadline`.

Le notifiche restano calcolate al volo come le altre categorie della
campanella (vedi services/notifications.py): la tabella MaintenanceDeadlineAck
filtra solo cosa nascondere per utente, non modifica la scadenza sottostante.
"""

from __future__ import annotations

from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import delete, select
from sqlalchemy.orm import Session, selectinload

from app.maintenance_asset_models import (
    MaintenanceAsset,
    MaintenanceAssetCounter,
    MaintenanceAssetType,
    MaintenanceDeadline,
    MaintenanceDeadlineAck,
)
from app.services.audit import record_audit_log
from app.services.errors import DomainError
from app.services.timeutils import today_local

_URGENCY_RANK = {"regolare": 0, "in_scadenza": 1, "urgente": 2, "scaduta": 3}


def _urgency_from_days_left(days_left: int, thresholds: list[int]) -> str:
    if days_left < 0:
        return "scaduta"
    thresholds = sorted(thresholds or [30, 15, 7])
    if not thresholds:
        return "regolare"
    if days_left <= thresholds[0]:
        return "urgente"
    if days_left <= thresholds[-1]:
        return "in_scadenza"
    return "regolare"


def _latest_hours_reading(db: Session, asset_id: str) -> MaintenanceAssetCounter | None:
    return db.scalar(
        select(MaintenanceAssetCounter)
        .where(MaintenanceAssetCounter.asset_id == asset_id, MaintenanceAssetCounter.unit == "ore")
        .order_by(MaintenanceAssetCounter.reading_date.desc())
        .limit(1)
    )


def hours_projection(db: Session, deadline: MaintenanceDeadline) -> tuple[float | None, date | None]:
    """Stima ore correnti e data di superamento soglia dalle ultime due letture
    contaore (§9/§13 — nessuna nuova tabella, si riusa MaintenanceAssetCounter).
    `due_hours` è sempre una soglia relativa alle ore registrate all'ultima
    manutenzione (`last_completed_hours`), non al totale storico del contaore:
    la scadenza a ore è raggiunta quando current_hours >= last_completed_hours + due_hours.
    Restituisce (None, None) se manca la soglia, non ci sono letture "ore", o il
    ritmo d'uso stimato è nullo/negativo (nessuna proiezione affidabile)."""
    if deadline.due_hours is None:
        return None, None
    readings = list(
        db.scalars(
            select(MaintenanceAssetCounter)
            .where(MaintenanceAssetCounter.asset_id == deadline.asset_id, MaintenanceAssetCounter.unit == "ore")
            .order_by(MaintenanceAssetCounter.reading_date.asc())
        ).all()
    )
    if not readings:
        return None, None
    latest = readings[-1]
    current_hours = float(latest.value)
    baseline_hours = float(deadline.last_completed_hours) if deadline.last_completed_hours is not None else 0.0
    effective_due_hours = baseline_hours + float(deadline.due_hours)
    if current_hours >= effective_due_hours:
        return current_hours, latest.reading_date
    if len(readings) < 2:
        return current_hours, None
    prev = readings[-2]
    days_span = (latest.reading_date - prev.reading_date).days
    if days_span <= 0:
        return current_hours, None
    rate = (float(latest.value) - float(prev.value)) / days_span
    if rate <= 0:
        return current_hours, None
    hours_left = effective_due_hours - current_hours
    projected_date = latest.reading_date + timedelta(days=round(hours_left / rate))
    return current_hours, projected_date


def compute_urgency(
    db: Session,
    deadline: MaintenanceDeadline,
    today: date | None = None,
    *,
    projection: tuple[float | None, date | None] | None = None,
) -> str:
    """`projection` evita una seconda query a `maintenance_asset_counters`
    quando il chiamante ha già invocato `hours_projection` per la stessa
    scadenza (es. `serialize_deadline`): senza questo parametro ogni lettura
    di una scadenza a ore costava due query identiche."""
    today = today or today_local()
    date_urgency = _urgency_from_days_left((deadline.due_date - today).days, deadline.notice_thresholds_days)
    if deadline.due_hours is None:
        return date_urgency
    _current_hours, projected_date = projection if projection is not None else hours_projection(db, deadline)
    if projected_date is None:
        return date_urgency
    hours_urgency = _urgency_from_days_left((projected_date - today).days, deadline.notice_thresholds_days)
    return date_urgency if _URGENCY_RANK[date_urgency] >= _URGENCY_RANK[hours_urgency] else hours_urgency


def create_deadline(
    db: Session,
    asset: MaintenanceAsset,
    *,
    deadline_type: str,
    due_date: date,
    recurrence_basis,
    recurrence_days: int | None,
    due_hours: float | None = None,
    recurrence_hours: int | None = None,
    notice_thresholds_days: list[int],
    last_completed_at: date | None = None,
    last_completed_hours: float | None = None,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceDeadline:
    if due_hours is not None and not asset.asset_type.tracks_usage_hours:
        raise DomainError("Questa sottoclasse di asset non gestisce le ore: attivalo da Manutenzioni › Categorie.")
    if deadline_type not in asset.asset_type.deadline_type_options:
        raise DomainError(f"Tipo scadenza «{deadline_type}» non riconosciuto per questa sottoclasse: sceglilo dall'elenco.")
    # `due_hours` è una soglia relativa all'ultima manutenzione (vedi hours_projection).
    # Se l'utente dichiara esplicitamente quando è avvenuta (la scadenza spesso si
    # crea in un momento diverso dall'intervento), quella diventa la baseline;
    # altrimenti si assume che l'asset sia "in pari" con l'ultima lettura contaore.
    resolved_last_completed_hours = None
    if due_hours is not None:
        if last_completed_hours is not None:
            resolved_last_completed_hours = Decimal(str(last_completed_hours))
        else:
            latest_reading = _latest_hours_reading(db, asset.id)
            if latest_reading is not None:
                resolved_last_completed_hours = latest_reading.value
    deadline = MaintenanceDeadline(
        asset_id=asset.id,
        deadline_type=deadline_type,
        due_date=due_date,
        recurrence_basis=recurrence_basis,
        recurrence_days=recurrence_days,
        due_hours=Decimal(str(due_hours)) if due_hours is not None else None,
        recurrence_hours=recurrence_hours,
        last_completed_at=last_completed_at,
        last_completed_hours=resolved_last_completed_hours,
        notice_thresholds_days=sorted(notice_thresholds_days) if notice_thresholds_days else [30, 15, 7],
    )
    db.add(deadline)
    db.flush()
    record_audit_log(
        db,
        action="create",
        entity="maintenance_deadline",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": deadline.id, "asset_id": asset.id, "deadline_type": deadline_type, "due_date": due_date.isoformat()},
    )
    return deadline


def _compute_next_due_date(deadline: MaintenanceDeadline, completed_date: date) -> date | None:
    if not deadline.recurrence_days:
        return None
    if deadline.recurrence_basis and deadline.recurrence_basis.value == "da_prevista":
        return deadline.due_date + timedelta(days=deadline.recurrence_days)
    return completed_date + timedelta(days=deadline.recurrence_days)


def complete_deadline(
    db: Session,
    deadline: MaintenanceDeadline,
    *,
    completed_date: date,
    completed_hours: float | None = None,
    confirm_next_due_date: bool,
    next_due_date_override: date | None,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceDeadline:
    deadline.last_completed_at = completed_date
    if completed_hours is not None:
        deadline.last_completed_hours = Decimal(str(completed_hours))

    proposed_next = next_due_date_override or _compute_next_due_date(deadline, completed_date)
    if confirm_next_due_date:
        if proposed_next is None:
            raise DomainError("Nessuna ricorrenza configurata: indica manualmente la prossima scadenza.")
        deadline.due_date = proposed_next
        # `due_hours` resta la soglia relativa all'ultima manutenzione: per il
        # prossimo ciclo diventa `recurrence_hours` (se impostata), mentre la
        # baseline è già stata aggiornata sopra in `last_completed_hours`.
        if deadline.due_hours is not None and deadline.recurrence_hours:
            deadline.due_hours = Decimal(str(deadline.recurrence_hours))

    record_audit_log(
        db,
        action="complete",
        entity="maintenance_deadline",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={
            "id": deadline.id,
            "completed_date": completed_date.isoformat(),
            "next_due_date": deadline.due_date.isoformat() if confirm_next_due_date else None,
        },
    )
    return deadline


def postpone_deadline(
    db: Session,
    deadline: MaintenanceDeadline,
    *,
    new_due_date: date,
    reason: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceDeadline:
    old_due_date = deadline.due_date
    deadline.due_date = new_due_date
    deadline.postponed_reason = reason

    record_audit_log(
        db,
        action="postpone",
        entity="maintenance_deadline",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={
            "id": deadline.id,
            "old_due_date": old_due_date.isoformat(),
            "new_due_date": new_due_date.isoformat(),
            "reason": reason,
        },
    )
    return deadline


def list_deadlines(db: Session, *, asset_id: str | None = None, active_only: bool = True) -> list[MaintenanceDeadline]:
    statement = select(MaintenanceDeadline).options(
        selectinload(MaintenanceDeadline.asset)
        .selectinload(MaintenanceAsset.asset_type)
        .selectinload(MaintenanceAssetType.asset_class)
    )
    if asset_id:
        statement = statement.where(MaintenanceDeadline.asset_id == asset_id)
    if active_only:
        statement = statement.where(MaintenanceDeadline.is_active.is_(True))
    statement = statement.order_by(MaintenanceDeadline.due_date.asc())
    return list(db.scalars(statement).all())


def get_deadline_or_404(db: Session, deadline_id: str) -> MaintenanceDeadline:
    deadline = db.get(
        MaintenanceDeadline,
        deadline_id,
        options=[
            selectinload(MaintenanceDeadline.asset)
            .selectinload(MaintenanceAsset.asset_type)
            .selectinload(MaintenanceAssetType.asset_class)
        ],
    )
    if deadline is None:
        raise DomainError("Scadenza non trovata.")
    return deadline


def delete_deadline(
    db: Session,
    deadline: MaintenanceDeadline,
    *,
    actor_name: str | None,
    actor_user_id: str | None,
) -> None:
    deadline_id = deadline.id
    db.execute(delete(MaintenanceDeadlineAck).where(MaintenanceDeadlineAck.deadline_id == deadline_id))
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_deadline",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": deadline_id, "deadline_type": deadline.deadline_type, "asset_id": deadline.asset_id},
    )
    db.delete(deadline)


def ack_deadline(db: Session, deadline_id: str, user_id: str) -> None:
    existing = db.scalar(
        select(MaintenanceDeadlineAck).where(
            MaintenanceDeadlineAck.deadline_id == deadline_id,
            MaintenanceDeadlineAck.user_id == user_id,
        )
    )
    if existing is not None:
        return
    db.add(MaintenanceDeadlineAck(deadline_id=deadline_id, user_id=user_id))


def build_deadline_notifications(db: Session, current_user) -> list[dict]:
    """Voci per la campanella (vedi services/notifications.py): solo scadenze
    entro soglia o scadute, non ancora marcate come lette da questo utente."""
    acked_ids = set(
        db.scalars(
            select(MaintenanceDeadlineAck.deadline_id).where(MaintenanceDeadlineAck.user_id == current_user.id)
        ).all()
    )

    notifications: list[dict] = []
    for deadline in list_deadlines(db, active_only=True):
        if deadline.id in acked_ids:
            continue
        projection = hours_projection(db, deadline) if deadline.due_hours is not None else None
        urgency = compute_urgency(db, deadline, projection=projection)
        if urgency == "regolare":
            continue
        urgency_labels = {"scaduta": "Scaduta", "urgente": "Urgente", "in_scadenza": "In scadenza"}
        notifications.append({
            "id": f"maintenance-deadline:{deadline.id}",
            "category": "maintenance_deadline",
            "title": f"{urgency_labels[urgency]}: {deadline.deadline_type}",
            "message": f"{deadline.asset.internal_code} · scadenza {deadline.due_date.strftime('%d/%m/%Y')}",
            "detail": None,
            "href": f"/manutenzioni/scadenze?asset={deadline.asset_id}",
            "created_at": None,
        })
    return notifications

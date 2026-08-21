from __future__ import annotations

from datetime import timezone
from urllib.parse import urlencode

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.enums import JustificationType
from app.models import DeviceDelivery, Employee, User
from app.services.absence_permissions import (
    get_linked_tms_employee,
    list_pending_justifications_for_approver,
)
from app.services.operational_reporting import list_reporting_notifications


JUSTIFICATION_LABELS = {
    JustificationType.ferie: "Ferie",
    JustificationType.permesso: "Permesso",
    JustificationType.altro: "Altra assenza",
}


def _date_range_label(start_date, end_date) -> str:
    if start_date == end_date:
        return start_date.strftime("%d/%m/%Y")
    return f"{start_date.strftime('%d/%m/%Y')}–{end_date.strftime('%d/%m/%Y')}"


def build_notifications(
    db: Session,
    current_user: User,
    target_employee: Employee | None = None,
) -> list[dict]:
    employee = target_employee or get_linked_tms_employee(db, current_user)
    if employee is None:
        return []

    notifications: list[dict] = []
    for item in list_reporting_notifications(
        db,
        current_user,
        target_employee=employee,
    ):
        query = urlencode({
            "day": item["work_date"].isoformat(),
            "team": item["team_id"],
            "employee": item["missing_employee_ids"][0],
        })
        notifications.append({
            "id": item["id"],
            "category": "operational_reporting",
            "title": item["title"],
            "message": item["message"],
            "detail": ", ".join(item["missing_employee_names"]),
            "href": f"/rendicontazioni/operativa?{query}",
            "created_at": None,
        })

    for justification in list_pending_justifications_for_approver(db, employee):
        type_label = JUSTIFICATION_LABELS.get(justification.justification_type, "Assenza")
        notifications.append({
            "id": f"absence-approval:{justification.id}",
            "category": "absence_approval",
            "title": f"Richiesta di {type_label.lower()} da approvare",
            "message": (
                f"{justification.employee.full_name} · "
                f"{_date_range_label(justification.start_date, justification.end_date)}"
            ),
            "detail": justification.created_by_name,
            "href": "/",
            "created_at": justification.created_at,
        })

    signature_requests = db.scalars(
        select(DeviceDelivery)
        .where(
            DeviceDelivery.employee_id == employee.id,
            DeviceDelivery.returned_at.is_(None),
            DeviceDelivery.signature_requested_at.is_not(None),
            or_(
                DeviceDelivery.signed_at.is_(None),
                DeviceDelivery.signed_at < DeviceDelivery.signature_requested_at,
            ),
        )
        .order_by(DeviceDelivery.signature_requested_at.desc())
    ).all()
    for delivery in signature_requests:
        notifications.append({
            "id": f"device-delivery-signature:{delivery.id}",
            "category": "device_delivery_signature",
            "title": "Firma consegna dispositivo richiesta",
            "message": delivery.device_label,
            "detail": "Apri la consegna, leggi la policy e apponi la firma.",
            "href": f"/le-mie-consegne/{delivery.id}/firma",
            "created_at": delivery.signature_requested_at,
        })

    def sort_key(notification: dict) -> tuple[int, float]:
        created_at = notification["created_at"]
        if created_at is None:
            return (0, 0.0)
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
        return (1, created_at.timestamp())

    notifications.sort(key=sort_key, reverse=True)
    return notifications

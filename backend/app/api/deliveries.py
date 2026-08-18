import re
import unicodedata
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    deliveries_tablet_label,
    require_deliveries_tablet_access,
    require_deliveries_access,
    require_deliveries_access_or_tablet,
)
from app.db import get_db
from app.models import Employee, EquipmentDelivery, EquipmentItem, SizeOption, User
from app.schemas import (
    EquipmentDeliveryCreate,
    EquipmentDeliveryListRead,
    EquipmentDeliveryRead,
    EquipmentDeliveryReturn,
    EquipmentDeliveryUpdate,
    PaginatedEquipmentDeliveryList,
    PaginatedEquipmentDeliveries,
)
from app.services.audit import record_audit_log
from app.services.deliveries_export import export_deliveries_xlsx
from app.services.deliveries_ppe_docx import export_employee_deliveries_docx
from app.services.security import get_current_user

router = APIRouter(prefix="/deliveries", tags=["deliveries"])


def _normalize_datetime(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _employee_role(employee: Employee | None) -> str | None:
    if employee is None:
        return None
    return employee.organization_role or employee.tms_role_description


def _delivery_status(delivery: EquipmentDelivery) -> str:
    return "returned" if delivery.returned_at is not None else "open"


def serialize_delivery(delivery: EquipmentDelivery) -> EquipmentDeliveryRead:
    return EquipmentDeliveryRead(
        id=delivery.id,
        employee_id=delivery.employee_id,
        employee_name=delivery.employee.full_name if delivery.employee else "",
        employee_role=_employee_role(delivery.employee),
        item_id=delivery.item_id,
        item_name=delivery.item_name,
        item_category=delivery.item_category,
        item_size=delivery.item_size,
        quantity=delivery.quantity,
        delivered_by=delivery.delivered_by,
        delivered_at=delivery.delivered_at,
        returned_at=delivery.returned_at,
        status=_delivery_status(delivery),
        notes=delivery.notes,
        signature_b64=delivery.signature_b64,
        created_at=delivery.created_at,
        updated_at=delivery.updated_at,
    )


def serialize_delivery_list(delivery: EquipmentDelivery) -> EquipmentDeliveryListRead:
    return EquipmentDeliveryListRead(
        id=delivery.id,
        employee_id=delivery.employee_id,
        employee_name=delivery.employee.full_name if delivery.employee else "",
        employee_role=_employee_role(delivery.employee),
        item_id=delivery.item_id,
        item_name=delivery.item_name,
        item_category=delivery.item_category,
        item_size=delivery.item_size,
        quantity=delivery.quantity,
        delivered_by=delivery.delivered_by,
        delivered_at=delivery.delivered_at,
        returned_at=delivery.returned_at,
        status=_delivery_status(delivery),
        notes=delivery.notes,
        created_at=delivery.created_at,
        updated_at=delivery.updated_at,
    )


def serialize_delivery_mobile(delivery: EquipmentDelivery) -> dict:
    """Formato 'consegna' atteso dall'app mobile Consegne: oggetto singolo con
    firma e items annidati (vedi ConsegneRepository.kt riga 651)."""
    return {
        "id": delivery.id,
        "employee_id": delivery.employee_id,
        "employee_name": delivery.employee.full_name if delivery.employee else "",
        "delivered_by": delivery.delivered_by,
        "notes": delivery.notes,
        "status": _delivery_status(delivery),
        "delivered_at": delivery.delivered_at.isoformat(),
        "returned_at": delivery.returned_at.isoformat() if delivery.returned_at else None,
        "signature": {"image_b64": delivery.signature_b64},
        "items": [
            {
                "item_id": delivery.item_id,
                "item_name": delivery.item_name,
                "category": delivery.item_category,
                "size": delivery.item_size,
                "quantity": delivery.quantity,
            }
        ],
    }


def _apply_filters(statement, *, status_value: str, employee_id: str | None, search: str | None):
    if employee_id:
        statement = statement.where(EquipmentDelivery.employee_id == employee_id)
    normalized_status = status_value.strip().lower()
    if normalized_status == "open":
        statement = statement.where(EquipmentDelivery.returned_at.is_(None))
    elif normalized_status == "returned":
        statement = statement.where(EquipmentDelivery.returned_at.is_not(None))
    elif normalized_status != "all":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Filtro stato non valido.")

    if search:
        pattern = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(
                func.lower(EquipmentDelivery.item_name).like(pattern),
                func.lower(EquipmentDelivery.item_category).like(pattern),
                func.lower(Employee.full_name).like(pattern),
                func.lower(func.coalesce(Employee.organization_role, "")).like(pattern),
                func.lower(func.coalesce(Employee.tms_role_description, "")).like(pattern),
            )
        )
    return statement


def _slugify_filename(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value)
    ascii_value = normalized.encode("ascii", "ignore").decode("ascii")
    return re.sub(r"[^A-Za-z0-9]+", "-", ascii_value).strip("-").lower() or "consegne"


@router.post("", status_code=status.HTTP_201_CREATED)
def create_delivery(
    payload: EquipmentDeliveryCreate,
    db: Session = Depends(get_db),
    auth_subject: User | None = Depends(require_deliveries_access_or_tablet),
) -> dict:
    if auth_subject is None:
        actor_name = deliveries_tablet_label()
        actor_user_id = None
    else:
        actor_name = auth_subject.username
        actor_user_id = auth_subject.id
    records = _create_delivery_records(
        payload=payload,
        db=db,
        actor_name=actor_name,
        actor_user_id=actor_user_id,
    )
    return {"delivery": serialize_delivery_mobile(records[0])}


@router.post("/external", response_model=list[EquipmentDeliveryRead], status_code=status.HTTP_201_CREATED)
def create_delivery_external(
    payload: EquipmentDeliveryCreate,
    db: Session = Depends(get_db),
    tablet_label: str = Depends(require_deliveries_tablet_access),
) -> list[EquipmentDeliveryRead]:
    records = _create_delivery_records(
        payload=payload,
        db=db,
        actor_name=tablet_label,
        actor_user_id=None,
    )
    return [serialize_delivery(delivery) for delivery in records]


def _create_delivery_records(
    *,
    payload: EquipmentDeliveryCreate,
    db: Session,
    actor_name: str | None,
    actor_user_id: str | None,
) -> list[EquipmentDelivery]:
    employee = db.get(Employee, payload.employee_id)
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato.")
    if not payload.signature.image_b64.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La firma e obbligatoria.")

    item_ids = [item.item_id for item in payload.items]
    items = {
        item.id: item
        for item in db.scalars(
            select(EquipmentItem)
            .where(EquipmentItem.id.in_(item_ids))
            .options(selectinload(EquipmentItem.available_size_options).selectinload(SizeOption.group))
        ).all()
    }
    missing = [item_id for item_id in item_ids if item_id not in items]
    if missing:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Uno o piu articoli non esistono.")

    delivered_at = _normalize_datetime(payload.delivered_at) or datetime.now(timezone.utc)
    delivered_by = (payload.delivered_by or actor_name or "").strip() or actor_name or employee.full_name
    notes = payload.notes.strip() if payload.notes else None
    signature_b64 = payload.signature.image_b64.strip()

    created_records: list[EquipmentDelivery] = []
    for row in payload.items:
        item = items[row.item_id]
        allowed_sizes = {option.value for option in item.available_size_options}
        selected_size = (row.size or "").strip() or None
        if allowed_sizes and not selected_size:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Taglia obbligatoria per {item.name}.")
        if allowed_sizes and selected_size not in allowed_sizes:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Taglia non valida per {item.name}.")
        delivery = EquipmentDelivery(
            employee_id=employee.id,
            item_id=item.id,
            item_name=item.name,
            item_category=item.category,
            item_size=selected_size,
            quantity=row.quantity,
            delivered_by=delivered_by,
            delivered_at=delivered_at,
            notes=notes,
            signature_b64=signature_b64,
        )
        db.add(delivery)
        created_records.append(delivery)

    record_audit_log(
        db,
        action="create",
        entity="equipment_delivery",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "items": payload.model_dump(mode="json")["items"],
            "delivered_by": delivered_by,
        },
    )
    db.commit()
    refreshed_records = db.scalars(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id.in_([delivery.id for delivery in created_records]))
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
        .order_by(EquipmentDelivery.created_at.asc())
    ).all()
    return list(refreshed_records)


@router.get("", response_model=PaginatedEquipmentDeliveries, dependencies=[Depends(require_deliveries_access)])
def list_deliveries(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=50, ge=1, le=500),
    status_value: str = Query(default="open", alias="status"),
    employee_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> PaginatedEquipmentDeliveries:
    statement: Select[tuple[EquipmentDelivery]] = (
        select(EquipmentDelivery)
        .join(Employee)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    statement = _apply_filters(statement, status_value=status_value, employee_id=employee_id, search=search)
    statement = statement.order_by(EquipmentDelivery.delivered_at.desc(), EquipmentDelivery.created_at.desc())
    deliveries = db.scalars(statement.offset((page - 1) * size).limit(size)).all()

    count_statement = select(func.count()).select_from(EquipmentDelivery).join(Employee)
    count_statement = _apply_filters(count_statement, status_value=status_value, employee_id=employee_id, search=search)
    total = db.scalar(count_statement) or 0
    return PaginatedEquipmentDeliveries(items=[serialize_delivery(item) for item in deliveries], total=total, page=page, size=size)


@router.get("/history", response_model=PaginatedEquipmentDeliveryList, dependencies=[Depends(require_deliveries_access_or_tablet)])
def list_deliveries_history(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=500),
    status_value: str = Query(default="all", alias="status"),
    employee_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> PaginatedEquipmentDeliveryList:
    statement = (
        select(EquipmentDelivery)
        .join(Employee)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    statement = _apply_filters(statement, status_value=status_value, employee_id=employee_id, search=search)
    statement = statement.order_by(EquipmentDelivery.delivered_at.desc(), EquipmentDelivery.created_at.desc())
    deliveries = db.scalars(statement.offset((page - 1) * size).limit(size)).all()

    count_statement = select(func.count()).select_from(EquipmentDelivery).join(Employee)
    count_statement = _apply_filters(count_statement, status_value=status_value, employee_id=employee_id, search=search)
    total = db.scalar(count_statement) or 0
    return PaginatedEquipmentDeliveryList(items=[serialize_delivery_list(item) for item in deliveries], total=total, page=page, size=size)


@router.get("/export", dependencies=[Depends(require_deliveries_access)])
def export_deliveries(
    status_value: str = Query(default="open", alias="status"),
    employee_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    statement = (
        select(EquipmentDelivery)
        .join(Employee)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    statement = _apply_filters(statement, status_value=status_value, employee_id=employee_id, search=search)
    statement = statement.order_by(EquipmentDelivery.delivered_at.desc(), EquipmentDelivery.created_at.desc())
    content = export_deliveries_xlsx(serialize_delivery(item) for item in db.scalars(statement).all())
    filename = "consegne.xlsx" if status_value == "all" else f"consegne-{status_value}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/export/employee/{employee_id}", dependencies=[Depends(require_deliveries_access_or_tablet)])
def export_employee_sheet(
    employee_id: str,
    include_returned: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> Response:
    employee = db.get(Employee, employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato.")

    statement = (
        select(EquipmentDelivery)
        .where(EquipmentDelivery.employee_id == employee_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
        .order_by(EquipmentDelivery.delivered_at.asc(), EquipmentDelivery.created_at.asc())
    )
    if not include_returned:
        statement = statement.where(EquipmentDelivery.returned_at.is_(None))
    deliveries = db.scalars(statement).all()
    content = export_employee_deliveries_docx(employee=employee, deliveries=deliveries)
    filename = f"scheda-consegna-{_slugify_filename(employee.full_name)}.docx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{delivery_id}", response_model=EquipmentDeliveryRead, dependencies=[Depends(require_deliveries_access)])
def get_delivery(delivery_id: str, db: Session = Depends(get_db)) -> EquipmentDeliveryRead:
    delivery = db.scalar(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id == delivery_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    return serialize_delivery(delivery)


@router.delete("/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_deliveries_access)])
def delete_delivery(
    delivery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    delivery = db.scalar(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id == delivery_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")

    record_audit_log(
        db,
        action="delete",
        entity="equipment_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "id": delivery.id,
            "employee_id": delivery.employee_id,
            "employee_name": delivery.employee.full_name if delivery.employee else None,
            "item_id": delivery.item_id,
            "item_name": delivery.item_name,
            "item_category": delivery.item_category,
            "item_size": delivery.item_size,
            "quantity": delivery.quantity,
            "delivered_at": delivery.delivered_at.isoformat(),
            "returned_at": delivery.returned_at.isoformat() if delivery.returned_at else None,
        },
    )
    db.delete(delivery)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{delivery_id}", response_model=EquipmentDeliveryRead, dependencies=[Depends(require_deliveries_access)])
def update_delivery(
    delivery_id: str,
    payload: EquipmentDeliveryUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EquipmentDeliveryRead:
    delivery = db.scalar(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id == delivery_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")

    changes = payload.model_dump(exclude_unset=True)
    if "delivered_by" in changes:
        delivery.delivered_by = changes["delivered_by"].strip() if changes["delivered_by"] else None
    if "delivered_at" in changes and changes["delivered_at"] is not None:
        delivery.delivered_at = _normalize_datetime(changes["delivered_at"])
    if "notes" in changes:
        delivery.notes = changes["notes"].strip() if changes["notes"] else None
    if "returned_at" in changes:
        delivery.returned_at = _normalize_datetime(changes["returned_at"])

    record_audit_log(
        db,
        action="update",
        entity="equipment_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"id": delivery_id, **payload.model_dump(mode="json", exclude_unset=True)},
    )
    db.commit()
    delivery = db.scalar(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id == delivery_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    return serialize_delivery(delivery)


@router.post("/{delivery_id}/return")
def mark_delivery_returned(
    delivery_id: str,
    payload: EquipmentDeliveryReturn,
    db: Session = Depends(get_db),
    auth_subject: User | None = Depends(require_deliveries_access_or_tablet),
) -> dict:
    delivery = db.scalar(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id == delivery_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    if delivery.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Consegna gia restituita.")

    delivery.returned_at = _normalize_datetime(payload.returned_at) or datetime.now(timezone.utc)
    actor_name = auth_subject.username if auth_subject is not None else deliveries_tablet_label()
    actor_user_id = auth_subject.id if auth_subject is not None else None
    record_audit_log(
        db,
        action="return",
        entity="equipment_delivery",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": delivery_id, "returned_at": delivery.returned_at.isoformat()},
    )
    db.commit()
    delivery = db.scalar(
        select(EquipmentDelivery)
        .where(EquipmentDelivery.id == delivery_id)
        .options(selectinload(EquipmentDelivery.employee), selectinload(EquipmentDelivery.item))
    )
    return {"delivery": serialize_delivery_mobile(delivery)}

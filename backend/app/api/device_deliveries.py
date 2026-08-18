from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import (
    deliveries_tablet_label,
    require_authenticated_or_tablet,
    require_deliveries_tablet_access,
    require_deliveries_access,
    require_deliveries_access_or_tablet,
)
from app.config import settings
from app.db import get_db
from app.models import DeviceAsset, DeviceDelivery, DeviceDeliveryPolicy, Employee, User
from app.schemas import (
    DeliveryPolicyRead,
    DeliveryPolicyUpdate,
    DeviceDeliveryAssignmentCreate,
    DeviceDeliveryCreate,
    DeviceDeliveryRead,
    DeviceDeliverySign,
    PaginatedDeviceDeliveries,
)
from app.services.absence_permissions import get_linked_tms_employee
from app.services.audit import record_audit_log
from app.services.email import get_employee_email, notify_device_delivery_signature_request
from app.services.security import get_current_user
from app.services.device_deliveries_export import export_device_deliveries_xlsx

router = APIRouter(prefix="/device-deliveries", tags=["device-deliveries"])


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


def _delivery_status(delivery: DeviceDelivery) -> str:
    if not delivery.signature_b64:
        return "pending_signature"
    if delivery.redelivered_to_delivery_id:
        return "redelivered"
    if delivery.returned_at is not None:
        return "returned"
    if delivery.return_requested_at is not None and not delivery.return_signature_b64:
        return "pending_return_signature"
    return "open"


def _device_label(device: DeviceAsset) -> str:
    device_label = " ".join(filter(None, [device.brand, device.model])).strip() or device.asset_type
    if device.serial_number:
        return f"{device_label} (S/N {device.serial_number})"
    return device_label


def _ensure_device_assignable(db: Session, device_id: str) -> None:
    existing_delivery = db.scalar(
        select(DeviceDelivery).where(
            DeviceDelivery.device_id == device_id,
            DeviceDelivery.returned_at.is_(None),
        )
    )
    if existing_delivery is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Il dispositivo risulta gia assegnato o in attesa firma.")


def _create_assignment_record(
    *,
    db: Session,
    employee: Employee,
    device: DeviceAsset,
    delivered_by: str,
    notes: str | None,
    delivered_at: datetime,
) -> DeviceDelivery:
    delivery = DeviceDelivery(
        employee_id=employee.id,
        device_id=device.id,
        device_label=_device_label(device),
        delivered_by=delivered_by,
        delivered_at=delivered_at,
        notes=notes,
        signature_b64=None,
    )
    db.add(delivery)
    return delivery


def _previous_delivery_ids_map(db: Session, delivery_ids: list[str]) -> dict[str, str]:
    if not delivery_ids:
        return {}
    rows = db.execute(
        select(DeviceDelivery.id, DeviceDelivery.redelivered_to_delivery_id).where(
            DeviceDelivery.redelivered_to_delivery_id.in_(delivery_ids)
        )
    ).all()
    return {
        redelivered_to_delivery_id: previous_delivery_id
        for previous_delivery_id, redelivered_to_delivery_id in rows
        if redelivered_to_delivery_id and redelivered_to_delivery_id != previous_delivery_id
    }


def serialize_device_delivery(delivery: DeviceDelivery, previous_delivery_id: str | None = None) -> DeviceDeliveryRead:
    return DeviceDeliveryRead(
        id=delivery.id,
        employee_id=delivery.employee_id,
        employee_name=delivery.employee.full_name if delivery.employee else "",
        employee_role=_employee_role(delivery.employee),
        device_id=delivery.device_id,
        device_label=delivery.device_label,
        device_asset_type=delivery.device.asset_type if delivery.device else "altro",
        device_serial_number=delivery.device.serial_number if delivery.device else "",
        delivered_by=delivery.delivered_by,
        delivered_at=delivery.delivered_at,
        returned_at=delivery.returned_at,
        return_requested_at=delivery.return_requested_at,
        status=_delivery_status(delivery),
        is_redelivery=previous_delivery_id is not None,
        previous_delivery_id=previous_delivery_id,
        notes=delivery.notes,
        signature_b64=delivery.signature_b64,
        signature_source=delivery.signature_source,
        signed_at=delivery.signed_at,
        signature_requested_at=delivery.signature_requested_at,
        return_signature_b64=delivery.return_signature_b64,
        created_at=delivery.created_at,
        updated_at=delivery.updated_at,
    )


def _apply_filters(statement, *, status_value: str, employee_id: str | None, search: str | None):
    if employee_id:
        statement = statement.where(DeviceDelivery.employee_id == employee_id)
    normalized_status = status_value.strip().lower()
    if normalized_status == "open":
        statement = statement.where(DeviceDelivery.returned_at.is_(None))
    elif normalized_status == "redelivered":
        statement = statement.where(DeviceDelivery.redelivered_to_delivery_id.is_not(None))
    elif normalized_status == "returned":
        statement = statement.where(
            DeviceDelivery.returned_at.is_not(None),
            DeviceDelivery.redelivered_to_delivery_id.is_(None),
        )
    elif normalized_status == "pending_signature":
        statement = statement.where(
            DeviceDelivery.returned_at.is_(None),
            DeviceDelivery.signature_b64.is_(None),
        )
    elif normalized_status == "pending_return_signature":
        statement = statement.where(
            DeviceDelivery.returned_at.is_(None),
            DeviceDelivery.return_requested_at.is_not(None),
        )
    elif normalized_status != "all":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Filtro stato non valido.")

    if search:
        pattern = f"%{search.strip().lower()}%"
        statement = statement.where(
            or_(
                func.lower(DeviceDelivery.device_label).like(pattern),
                func.lower(func.coalesce(DeviceAsset.serial_number, "")).like(pattern),
                func.lower(Employee.full_name).like(pattern),
                func.lower(func.coalesce(Employee.organization_role, "")).like(pattern),
                func.lower(func.coalesce(Employee.tms_role_description, "")).like(pattern),
            )
        )
    return statement


@router.post("", response_model=DeviceDeliveryRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_deliveries_access)])
def create_device_delivery_assignment(
    payload: DeviceDeliveryAssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceDeliveryRead:
    employee = db.get(Employee, payload.employee_id)
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato.")
    device = db.get(DeviceAsset, payload.device_id)
    if device is None or not device.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo non trovato.")
    _ensure_device_assignable(db, device.id)

    delivery = _create_assignment_record(
        db=db,
        employee=employee,
        device=device,
        delivered_by=current_user.username,
        delivered_at=datetime.now(timezone.utc),
        notes=payload.notes.strip() if payload.notes else None,
    )
    record_audit_log(
        db,
        action="assign",
        entity="device_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "device_id": device.id,
            "device_label": delivery.device_label,
        },
    )
    db.commit()
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery.id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    return serialize_device_delivery(delivery)


@router.delete("/{delivery_id}", status_code=status.HTTP_204_NO_CONTENT, dependencies=[Depends(require_deliveries_access)])
def delete_device_delivery_assignment(
    delivery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")

    linked_deliveries = db.scalars(
        select(DeviceDelivery).where(DeviceDelivery.redelivered_to_delivery_id == delivery.id)
    ).all()
    for linked_delivery in linked_deliveries:
        linked_delivery.redelivered_to_delivery_id = None

    record_audit_log(
        db,
        action="delete",
        entity="device_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "id": delivery.id,
            "employee_id": delivery.employee_id,
            "employee_name": delivery.employee.full_name if delivery.employee else None,
            "device_id": delivery.device_id,
            "device_label": delivery.device_label,
            "status": _delivery_status(delivery),
        },
    )
    db.delete(delivery)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/{delivery_id}/redeliver", response_model=DeviceDeliveryRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_deliveries_access)])
def redeliver_device_delivery(
    delivery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceDeliveryRead:
    current_delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    if current_delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    if current_delivery.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La consegna e gia chiusa.")
    if not current_delivery.signature_b64:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La consegna non e ancora firmata.")
    if current_delivery.return_requested_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La riconsegna e gia in attesa di firma.")

    current_delivery.return_requested_at = datetime.now(timezone.utc)
    record_audit_log(
        db,
        action="redeliver_requested",
        entity="device_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "id": current_delivery.id,
            "employee_id": current_delivery.employee_id,
            "employee_name": current_delivery.employee.full_name if current_delivery.employee else None,
            "device_id": current_delivery.device_id,
            "device_label": current_delivery.device_label,
            "return_requested_at": current_delivery.return_requested_at.isoformat(),
        },
    )
    db.commit()
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == current_delivery.id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    return serialize_device_delivery(delivery)


@router.post("/external", response_model=DeviceDeliveryRead, status_code=status.HTTP_201_CREATED)
def create_device_delivery_external(
    payload: DeviceDeliveryCreate,
    db: Session = Depends(get_db),
    tablet_label: str = Depends(require_deliveries_tablet_access),
) -> DeviceDeliveryRead:
    employee = db.get(Employee, payload.employee_id)
    if employee is None or not employee.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dipendente non trovato.")
    device = db.get(DeviceAsset, payload.device_id)
    if device is None or not device.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo non trovato.")
    if not payload.signature.image_b64.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La firma e obbligatoria.")
    _ensure_device_assignable(db, device.id)

    device_label = _device_label(device)

    delivery = DeviceDelivery(
        employee_id=employee.id,
        device_id=device.id,
        device_label=device_label,
        delivered_by=(payload.delivered_by or tablet_label or "").strip() or tablet_label,
        delivered_at=_normalize_datetime(payload.delivered_at) or datetime.now(timezone.utc),
        notes=payload.notes.strip() if payload.notes else None,
        signature_b64=payload.signature.image_b64.strip(),
        signature_source="tablet",
        signed_at=datetime.now(timezone.utc),
    )
    db.add(delivery)
    record_audit_log(
        db,
        action="create",
        entity="device_delivery",
        actor_name=tablet_label,
        user_id=None,
        detail={
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "device_id": device.id,
            "device_label": device_label,
        },
    )
    db.commit()
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery.id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    return serialize_device_delivery(delivery)


@router.post("/{delivery_id}/sign", response_model=DeviceDeliveryRead, status_code=status.HTTP_200_OK)
def sign_device_delivery_external(
    delivery_id: str,
    payload: DeviceDeliverySign,
    db: Session = Depends(get_db),
    tablet_label: str = Depends(require_deliveries_tablet_access),
) -> DeviceDeliveryRead:
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    if delivery.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Consegna gia restituita.")
    if not payload.signature.image_b64.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La firma e obbligatoria.")

    if not delivery.signature_b64:
        delivery.signature_b64 = payload.signature.image_b64.strip()
        delivery.signature_source = "tablet"
        delivery.signed_at = datetime.now(timezone.utc)
        record_audit_log(
            db,
            action="sign",
            entity="device_delivery",
            actor_name=tablet_label,
            user_id=None,
            detail={"id": delivery_id},
        )
    elif delivery.return_requested_at is not None:
        delivery.return_signature_b64 = payload.signature.image_b64.strip()
        delivery.returned_at = datetime.now(timezone.utc)
        delivery.redelivered_to_delivery_id = delivery.id
        record_audit_log(
            db,
            action="sign_return",
            entity="device_delivery",
            actor_name=tablet_label,
            user_id=None,
            detail={"id": delivery_id, "returned_at": delivery.returned_at.isoformat()},
        )
    else:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Consegna gia firmata.")
    db.commit()
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    previous_delivery_id = db.scalar(
        select(DeviceDelivery.id).where(DeviceDelivery.redelivered_to_delivery_id == delivery.id)
    )
    return serialize_device_delivery(
        delivery,
        previous_delivery_id=previous_delivery_id if previous_delivery_id != delivery.id else None,
    )


@router.get("/pending", response_model=list[DeviceDeliveryRead])
def list_pending_device_deliveries_external(
    db: Session = Depends(get_db),
    _tablet_label: str = Depends(require_deliveries_tablet_access),
) -> list[DeviceDeliveryRead]:
    deliveries = db.scalars(
        select(DeviceDelivery)
        .where(DeviceDelivery.returned_at.is_(None))
        .where(
            or_(
                DeviceDelivery.signature_b64.is_(None),
                DeviceDelivery.return_requested_at.is_not(None),
            )
        )
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
        .order_by(DeviceDelivery.delivered_at.desc(), DeviceDelivery.created_at.desc())
    ).all()
    previous_ids = _previous_delivery_ids_map(db, [item.id for item in deliveries])
    return [serialize_device_delivery(item, previous_delivery_id=previous_ids.get(item.id)) for item in deliveries]


@router.get("", response_model=PaginatedDeviceDeliveries, dependencies=[Depends(require_deliveries_access)])
def list_device_deliveries(
    page: int = Query(default=1, ge=1),
    size: int = Query(default=100, ge=1, le=500),
    status_value: str = Query(default="open", alias="status"),
    employee_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> PaginatedDeviceDeliveries:
    statement = (
        select(DeviceDelivery)
        .join(Employee)
        .join(DeviceAsset)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    statement = _apply_filters(statement, status_value=status_value, employee_id=employee_id, search=search)
    statement = statement.order_by(DeviceDelivery.delivered_at.desc(), DeviceDelivery.created_at.desc())
    deliveries = db.scalars(statement.offset((page - 1) * size).limit(size)).all()
    previous_ids = _previous_delivery_ids_map(db, [item.id for item in deliveries])

    count_statement = select(func.count()).select_from(DeviceDelivery).join(Employee).join(DeviceAsset)
    count_statement = _apply_filters(count_statement, status_value=status_value, employee_id=employee_id, search=search)
    total = db.scalar(count_statement) or 0
    return PaginatedDeviceDeliveries(
        items=[serialize_device_delivery(item, previous_delivery_id=previous_ids.get(item.id)) for item in deliveries],
        total=total,
        page=page,
        size=size,
    )


@router.get("/export", dependencies=[Depends(require_deliveries_access)])
def export_device_deliveries(
    status_value: str = Query(default="open", alias="status"),
    employee_id: str | None = None,
    search: str | None = None,
    db: Session = Depends(get_db),
) -> Response:
    statement = (
        select(DeviceDelivery)
        .join(Employee)
        .join(DeviceAsset)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    statement = _apply_filters(statement, status_value=status_value, employee_id=employee_id, search=search)
    statement = statement.order_by(DeviceDelivery.delivered_at.desc(), DeviceDelivery.created_at.desc())
    deliveries = db.scalars(statement).all()
    previous_ids = _previous_delivery_ids_map(db, [item.id for item in deliveries])
    content = export_device_deliveries_xlsx(
        serialize_device_delivery(item, previous_delivery_id=previous_ids.get(item.id))
        for item in deliveries
    )
    filename = "consegne-dispositivi.xlsx" if status_value == "all" else f"consegne-dispositivi-{status_value}.xlsx"
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.post("/{delivery_id}/return")
def mark_device_delivery_returned(
    delivery_id: str,
    db: Session = Depends(get_db),
    auth_subject: User | None = Depends(require_deliveries_access_or_tablet),
) -> dict:
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    if delivery.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Consegna gia restituita.")
    if not delivery.signature_b64:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Consegna non ancora firmata.")

    delivery.returned_at = datetime.now(timezone.utc)
    actor_name = auth_subject.username if auth_subject is not None else deliveries_tablet_label()
    actor_user_id = auth_subject.id if auth_subject is not None else None
    record_audit_log(
        db,
        action="return",
        entity="device_delivery",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": delivery_id, "returned_at": delivery.returned_at.isoformat()},
    )
    db.commit()
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    previous_delivery_id = db.scalar(
        select(DeviceDelivery.id).where(DeviceDelivery.redelivered_to_delivery_id == delivery.id)
    )
    return {
        "delivery": serialize_device_delivery(
            delivery,
            previous_delivery_id=previous_delivery_id if previous_delivery_id != delivery.id else None,
        )
    }


@router.post("/{delivery_id}/request-signature", response_model=DeviceDeliveryRead, dependencies=[Depends(require_deliveries_access)])
def request_device_delivery_signature(
    delivery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceDeliveryRead:
    """Invia al dipendente l'email che lo invita a firmare (o aggiornare la firma
    della) consegna dalla pagina web autenticata."""
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    if delivery.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La consegna e gia chiusa: la firma non e piu richiedibile.")
    if not settings.smtp_enabled or not settings.smtp_host:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invio email non configurato (SMTP disabilitato).")
    employee_email = get_employee_email(db, delivery.employee_id)
    if not employee_email:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Il dipendente non ha un account collegato con indirizzo email: la firma va raccolta dall'app tablet.",
        )

    delivery.signature_requested_at = datetime.now(timezone.utc)
    record_audit_log(
        db,
        action="signature_requested",
        entity="device_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "id": delivery.id,
            "employee_id": delivery.employee_id,
            "employee_name": delivery.employee.full_name if delivery.employee else None,
            "device_label": delivery.device_label,
            "email": employee_email,
            "is_signature_update": bool(delivery.signature_b64),
        },
    )
    db.commit()
    notify_device_delivery_signature_request(db, delivery, current_user.username)
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    previous_delivery_id = db.scalar(
        select(DeviceDelivery.id).where(DeviceDelivery.redelivered_to_delivery_id == delivery.id)
    )
    return serialize_device_delivery(
        delivery,
        previous_delivery_id=previous_delivery_id if previous_delivery_id != delivery.id else None,
    )


def _get_own_delivery(db: Session, delivery_id: str, current_user: User) -> DeviceDelivery:
    """Carica la consegna verificando che appartenga al dipendente collegato
    all'utente autenticato: nessun altro (nemmeno un admin) puo firmare al suo posto."""
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Consegna non trovata.")
    linked_employee = get_linked_tms_employee(db, current_user)
    if linked_employee is None or linked_employee.id != delivery.employee_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Questa consegna non e assegnata al tuo utente: accedi con le credenziali del dipendente assegnatario.",
        )
    return delivery


@router.get("/my/{delivery_id}", response_model=DeviceDeliveryRead)
def get_my_device_delivery(
    delivery_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceDeliveryRead:
    delivery = _get_own_delivery(db, delivery_id, current_user)
    return serialize_device_delivery(delivery)


@router.post("/my/{delivery_id}/sign", response_model=DeviceDeliveryRead)
def sign_my_device_delivery(
    delivery_id: str,
    payload: DeviceDeliverySign,
    request: Request,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceDeliveryRead:
    """Firma web della consegna da parte del dipendente autenticato. Sovrascrive
    l'eventuale firma precedente ("l'ultima vince"); l'audit conserva la traccia."""
    delivery = _get_own_delivery(db, delivery_id, current_user)
    if delivery.returned_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="La consegna e gia chiusa: la firma non e piu modificabile.")
    if not payload.signature.image_b64.strip():
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="La firma e obbligatoria.")
    policy = db.scalar(select(DeviceDeliveryPolicy).order_by(DeviceDeliveryPolicy.updated_at.desc()))
    if policy is not None and not payload.policy_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Devi confermare di aver letto la policy prima di firmare.",
        )

    had_previous_signature = bool(delivery.signature_b64)
    previous_source = delivery.signature_source
    previous_signed_at = delivery.signed_at
    delivery.signature_b64 = payload.signature.image_b64.strip()
    delivery.signature_source = "web"
    delivery.signed_at = datetime.now(timezone.utc)

    forwarded = request.headers.get("x-forwarded-for", "")
    ip_address = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else None)
    record_audit_log(
        db,
        action="sign_web",
        entity="device_delivery",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "id": delivery.id,
            "employee_id": delivery.employee_id,
            "employee_name": delivery.employee.full_name if delivery.employee else None,
            "device_label": delivery.device_label,
            "ip_address": ip_address,
            "replaced_previous_signature": had_previous_signature,
            "previous_signature_source": previous_source,
            "previous_signed_at": previous_signed_at.isoformat() if previous_signed_at else None,
            "policy_accepted": policy is not None,
            "policy_title": policy.title if policy else None,
            "policy_updated_at": policy.updated_at.isoformat() if policy else None,
        },
    )
    db.commit()
    delivery = db.scalar(
        select(DeviceDelivery)
        .where(DeviceDelivery.id == delivery_id)
        .options(selectinload(DeviceDelivery.employee), selectinload(DeviceDelivery.device))
    )
    return serialize_device_delivery(delivery)


def _serialize_policy(policy: DeviceDeliveryPolicy) -> DeliveryPolicyRead:
    return DeliveryPolicyRead(
        id=policy.id,
        title=policy.title,
        content_html=policy.content_html,
        updated_by=policy.updated_by,
        created_at=policy.created_at,
        updated_at=policy.updated_at,
    )


@router.get("/policy", response_model=DeliveryPolicyRead | None, dependencies=[Depends(require_authenticated_or_tablet)])
def get_device_delivery_policy(db: Session = Depends(get_db)) -> DeliveryPolicyRead | None:
    """Policy da leggere prima della firma. Leggibile da qualunque utente
    autenticato (il dipendente che firma via web) e dall'app tablet via
    header X-Tablet-Key. Ritorna null se non ancora pubblicata."""
    policy = db.scalar(select(DeviceDeliveryPolicy).order_by(DeviceDeliveryPolicy.updated_at.desc()))
    return _serialize_policy(policy) if policy else None


@router.put("/policy", response_model=DeliveryPolicyRead, dependencies=[Depends(require_deliveries_access)])
def update_device_delivery_policy(
    payload: DeliveryPolicyUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeliveryPolicyRead:
    policy = db.scalar(select(DeviceDeliveryPolicy).order_by(DeviceDeliveryPolicy.updated_at.desc()))
    is_new = policy is None
    if policy is None:
        policy = DeviceDeliveryPolicy(title=payload.title.strip(), content_html=payload.content_html)
        db.add(policy)
    else:
        policy.title = payload.title.strip()
        policy.content_html = payload.content_html
    policy.updated_by = current_user.username
    record_audit_log(
        db,
        action="policy_created" if is_new else "policy_updated",
        entity="device_delivery_policy",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "title": policy.title,
            "content_length": len(payload.content_html),
        },
    )
    db.commit()
    db.refresh(policy)
    return _serialize_policy(policy)

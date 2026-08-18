from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, select
from sqlalchemy.orm import Session

from app.api.deps import require_deliveries_access, require_deliveries_access_or_tablet
from app.db import get_db
from app.models import DeviceAsset, User
from app.schemas import DeviceAssetCreate, DeviceAssetRead, DeviceAssetUpdate, DeviceSyncResult
from app.services.audit import record_audit_log
from app.services.ninjaone import NinjaOneError, sync_devices
from app.services.security import get_current_user

router = APIRouter(prefix="/device-assets", tags=["device-assets"])
VISIBLE_DEVICE_ASSET_TYPES = ("pc", "smartphone")


def serialize_device_asset(item: DeviceAsset) -> DeviceAssetRead:
    return DeviceAssetRead(
        id=item.id,
        asset_type=item.asset_type,
        brand=item.brand,
        model=item.model,
        serial_number=item.serial_number,
        imei=item.imei,
        iccid=item.iccid,
        phone_number=item.phone_number,
        notes=item.notes,
        is_active=item.is_active,
        source="ninjaone" if item.ninja_device_id else "manual",
        ninja_device_id=item.ninja_device_id,
        system_name=item.system_name,
        node_class=item.node_class,
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("", response_model=list[DeviceAssetRead])
def list_device_assets(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    _auth: User | None = Depends(require_deliveries_access_or_tablet),
) -> list[DeviceAssetRead]:
    statement: Select[tuple[DeviceAsset]] = select(DeviceAsset).where(DeviceAsset.asset_type.in_(VISIBLE_DEVICE_ASSET_TYPES))
    if not include_inactive:
        statement = statement.where(DeviceAsset.is_active.is_(True))
    statement = statement.order_by(DeviceAsset.asset_type.asc(), DeviceAsset.brand.asc(), DeviceAsset.model.asc())
    return [serialize_device_asset(item) for item in db.scalars(statement).all()]


@router.post("/sync", response_model=DeviceSyncResult, dependencies=[Depends(require_deliveries_access)])
def sync_device_assets(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceSyncResult:
    try:
        result = sync_devices(db)
    except NinjaOneError as exc:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(exc)) from exc
    record_audit_log(
        db,
        action="sync",
        entity="device_asset",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=result.model_dump(mode="json"),
    )
    db.commit()
    return result


@router.post("", response_model=DeviceAssetRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_deliveries_access)])
def create_device_asset(
    payload: DeviceAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceAssetRead:
    normalized_serial = payload.serial_number.strip() if payload.serial_number else None
    item = DeviceAsset(
        asset_type=payload.asset_type,
        brand=payload.brand.strip() if payload.brand else None,
        model=payload.model.strip() if payload.model else None,
        serial_number=normalized_serial,
        imei=payload.imei.strip() if payload.imei else None,
        iccid=payload.iccid.strip() if payload.iccid else None,
        phone_number=payload.phone_number.strip() if payload.phone_number else None,
        notes=payload.notes.strip() if payload.notes else None,
    )
    db.add(item)
    record_audit_log(
        db,
        action="create",
        entity="device_asset",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=payload.model_dump(mode="json"),
    )
    db.commit()
    db.refresh(item)
    return serialize_device_asset(item)


@router.patch("/{device_id}", response_model=DeviceAssetRead, dependencies=[Depends(require_deliveries_access)])
def update_device_asset(
    device_id: str,
    payload: DeviceAssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> DeviceAssetRead:
    item = db.get(DeviceAsset, device_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Dispositivo non trovato.")

    changes = payload.model_dump(exclude_unset=True)
    if "serial_number" in changes:
        normalized = changes["serial_number"].strip() if changes["serial_number"] else None
        item.serial_number = normalized
    if "asset_type" in changes and changes["asset_type"] is not None:
        item.asset_type = changes["asset_type"]
    if "brand" in changes:
        item.brand = changes["brand"].strip() if changes["brand"] else None
    if "model" in changes:
        item.model = changes["model"].strip() if changes["model"] else None
    if "imei" in changes:
        item.imei = changes["imei"].strip() if changes["imei"] else None
    if "iccid" in changes:
        item.iccid = changes["iccid"].strip() if changes["iccid"] else None
    if "phone_number" in changes:
        item.phone_number = changes["phone_number"].strip() if changes["phone_number"] else None
    if "notes" in changes:
        item.notes = changes["notes"].strip() if changes["notes"] else None
    if "is_active" in changes and changes["is_active"] is not None:
        item.is_active = changes["is_active"]

    record_audit_log(
        db,
        action="update",
        entity="device_asset",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"id": device_id, **changes},
    )
    db.commit()
    db.refresh(item)
    return serialize_device_asset(item)

import io

import qrcode
from fastapi import APIRouter, Depends, File, HTTPException, Query, Response, UploadFile, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_maintenance_access
from app.config import settings
from app.db import get_db
from app.enums import MaintenanceAssetStatus
from app.maintenance_asset_models import MaintenanceAsset, MaintenanceAssetClass, MaintenanceAssetFamily, MaintenanceAssetType
from app.maintenance_asset_schemas import (
    MaintenanceAssetClassCreate,
    MaintenanceAssetClassRead,
    MaintenanceAssetClassUpdate,
    MaintenanceAssetCommentCreate,
    MaintenanceAssetCommentRead,
    MaintenanceAssetCounterCreate,
    MaintenanceAssetCounterRead,
    MaintenanceAssetCounterUpdate,
    MaintenanceAssetCreate,
    MaintenanceAssetFamilyCreate,
    MaintenanceAssetFamilyRead,
    MaintenanceAssetFamilyUpdate,
    MaintenanceAssetFieldCreate,
    MaintenanceAssetFieldRead,
    MaintenanceAssetFieldUpdate,
    MaintenanceAssetHistoryRead,
    MaintenanceAssetQrTokenRead,
    MaintenanceAssetRead,
    MaintenanceHierarchyReorder,
    MaintenanceAssetTypeCreate,
    MaintenanceAssetTypeRead,
    MaintenanceAssetTypeUpdate,
    MaintenanceAssetUpdate,
)
from app.models import User
from app.services import maintenance_assets as service, maintenance_images
from app.services.errors import DomainError
from app.services.maintenance_export import export_maintenance_asset_counters_xlsx, export_maintenance_assets_xlsx

router = APIRouter(prefix="/maintenance", tags=["maintenance-assets"])


def serialize_field(field) -> MaintenanceAssetFieldRead:
    return MaintenanceAssetFieldRead(
        id=field.id,
        field_key=field.field_key,
        label=field.label,
        field_type=field.field_type,
        is_required=field.is_required,
        is_searchable=field.is_searchable,
        options=field.options,
        sort_order=field.sort_order,
    )


def serialize_asset_type(asset_type: MaintenanceAssetType) -> MaintenanceAssetTypeRead:
    return MaintenanceAssetTypeRead(
        id=asset_type.id,
        asset_class_id=asset_type.asset_class_id,
        code=asset_type.code,
        label=asset_type.label,
        icon=asset_type.icon,
        is_active=asset_type.is_active,
        sort_order=asset_type.sort_order,
        tracks_usage_hours=asset_type.tracks_usage_hours,
        fields=[serialize_field(field) for field in asset_type.fields],
        document_type_options=asset_type.document_type_options,
        deadline_type_options=asset_type.deadline_type_options,
    )


def serialize_asset_class(asset_class: MaintenanceAssetClass) -> MaintenanceAssetClassRead:
    return MaintenanceAssetClassRead(
        id=asset_class.id,
        family_id=asset_class.family_id,
        code=asset_class.code,
        label=asset_class.label,
        icon=asset_class.icon,
        is_active=asset_class.is_active,
        sort_order=asset_class.sort_order,
        fields=[serialize_field(field) for field in asset_class.fields],
        types=[serialize_asset_type(asset_type) for asset_type in asset_class.types],
    )


def serialize_asset_family(asset_family: MaintenanceAssetFamily) -> MaintenanceAssetFamilyRead:
    return MaintenanceAssetFamilyRead(
        id=asset_family.id,
        code=asset_family.code,
        label=asset_family.label,
        icon=asset_family.icon,
        is_active=asset_family.is_active,
        sort_order=asset_family.sort_order,
        classes=[serialize_asset_class(asset_class) for asset_class in asset_family.classes],
    )


def serialize_asset(
    asset: MaintenanceAsset,
    employee_field_names: dict[str, str] | None = None,
    image_ids: dict | None = None,
    last_modified_by: str | None = None,
) -> MaintenanceAssetRead:
    asset_type = asset.asset_type
    image_ids = image_ids or {}
    return MaintenanceAssetRead(
        id=asset.id,
        asset_type_id=asset.asset_type_id,
        asset_type_label=asset_type.label,
        asset_class_id=asset_type.asset_class_id,
        asset_class_label=asset_type.asset_class.label,
        document_type_options=asset_type.document_type_options,
        deadline_type_options=asset_type.deadline_type_options,
        internal_code=asset.internal_code,
        status=asset.status,
        status_reason=asset.status_reason,
        main_image_id=image_ids.get("main_image_id"),
        image_field_ids=image_ids.get("image_field_ids", {}),
        custom_fields=asset.custom_fields,
        employee_field_names=employee_field_names or {},
        has_qr_token=asset.qr_token is not None,
        created_at=asset.created_at,
        updated_at=asset.updated_at,
        last_modified_by=last_modified_by,
    )


def serialize_assets(
    db: Session, assets: list[MaintenanceAsset], *, include_last_modified_by: bool = False
) -> list[MaintenanceAssetRead]:
    names_by_asset = service.resolve_employee_field_names(db, assets)
    images_by_asset = maintenance_images.image_ids_by_asset(db, [asset.id for asset in assets])
    # Solo il dettaglio del singolo asset chiede l'autore dell'ultima modifica:
    # una lista (o l'export) di molti asset non deve pagare una query in più
    # a riga, quindi qui di default resta vuoto.
    last_modified_by_asset = (
        service.last_modified_by_assets(db, [asset.id for asset in assets]) if include_last_modified_by else {}
    )
    return [
        serialize_asset(
            asset,
            names_by_asset.get(asset.id),
            images_by_asset.get(asset.id),
            last_modified_by_asset.get(asset.id),
        )
        for asset in assets
    ]


@router.get("/asset-families", response_model=list[MaintenanceAssetFamilyRead])
def list_asset_families(
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetFamilyRead]:
    return [serialize_asset_family(item) for item in service.list_asset_families(db)]


@router.patch("/asset-families/reorder", response_model=list[MaintenanceAssetFamilyRead])
def reorder_asset_families(
    payload: MaintenanceHierarchyReorder,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[MaintenanceAssetFamilyRead]:
    service.reorder_asset_families(db, ordered_ids=payload.ordered_ids)
    db.commit()
    return [serialize_asset_family(item) for item in service.list_asset_families(db)]


@router.post("/asset-families", response_model=MaintenanceAssetFamilyRead, status_code=status.HTTP_201_CREATED)
def create_asset_family(
    payload: MaintenanceAssetFamilyCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetFamilyRead:
    asset_family = service.create_asset_family(db, code=payload.code.strip(), label=payload.label.strip(), icon=payload.icon.strip())
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già una famiglia con questo codice.") from exc
    db.refresh(asset_family)
    return serialize_asset_family(asset_family)


@router.patch("/asset-families/{asset_family_id}", response_model=MaintenanceAssetFamilyRead)
def update_asset_family(
    asset_family_id: str,
    payload: MaintenanceAssetFamilyUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetFamilyRead:
    asset_family = service.get_asset_family_or_404(db, asset_family_id)
    service.update_asset_family(db, asset_family, label=payload.label, icon=payload.icon)
    db.commit()
    db.refresh(asset_family)
    return serialize_asset_family(asset_family)


@router.delete("/asset-families/{asset_family_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_family(
    asset_family_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    asset_family = service.get_asset_family_or_404(db, asset_family_id)
    service.delete_asset_family(db, asset_family, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/asset-classes/{asset_class_id}/counters", response_model=list[MaintenanceAssetCounterRead])
def get_asset_class_counters(
    asset_class_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetCounterRead]:
    """Letture ore di tutti gli asset della classe, per la dashboard ore del
    parco (classifica per totale/oggi/mese/anno, calcolata lato frontend)."""
    service.get_asset_class_or_404(db, asset_class_id)
    return [
        MaintenanceAssetCounterRead(
            id=reading.id,
            reading_date=reading.reading_date,
            value=float(reading.value),
            unit=reading.unit,
            recorded_by=reading.recorded_by,
            created_at=reading.created_at,
            asset_id=reading.asset_id,
            asset_internal_code=reading.asset.internal_code,
        )
        for reading in service.list_counter_readings_for_asset_class(db, asset_class_id)
    ]


@router.get("/asset-classes", response_model=list[MaintenanceAssetClassRead])
def list_asset_classes(
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetClassRead]:
    return [serialize_asset_class(item) for item in service.list_asset_classes(db)]


@router.post(
    "/asset-families/{asset_family_id}/classes",
    response_model=MaintenanceAssetClassRead,
    status_code=status.HTTP_201_CREATED,
)
def create_asset_class(
    asset_family_id: str,
    payload: MaintenanceAssetClassCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetClassRead:
    asset_family = service.get_asset_family_or_404(db, asset_family_id)
    asset_class = service.create_asset_class(
        db, asset_family, code=payload.code.strip(), label=payload.label.strip(), icon=payload.icon.strip()
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già una classe con questo codice.") from exc
    db.refresh(asset_class)
    return serialize_asset_class(asset_class)


@router.patch("/asset-families/{asset_family_id}/classes/reorder", response_model=list[MaintenanceAssetClassRead])
def reorder_asset_classes(
    asset_family_id: str,
    payload: MaintenanceHierarchyReorder,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[MaintenanceAssetClassRead]:
    asset_family = service.get_asset_family_or_404(db, asset_family_id)
    service.reorder_asset_classes(db, asset_family, ordered_ids=payload.ordered_ids)
    db.commit()
    db.refresh(asset_family)
    return [serialize_asset_class(item) for item in asset_family.classes]


@router.patch("/asset-classes/{asset_class_id}", response_model=MaintenanceAssetClassRead)
def update_asset_class(
    asset_class_id: str,
    payload: MaintenanceAssetClassUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetClassRead:
    asset_class = service.get_asset_class_or_404(db, asset_class_id)
    service.update_asset_class(db, asset_class, label=payload.label, icon=payload.icon)
    db.commit()
    db.refresh(asset_class)
    return serialize_asset_class(asset_class)


@router.delete("/asset-classes/{asset_class_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_class(
    asset_class_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    asset_class = service.get_asset_class_or_404(db, asset_class_id)
    service.delete_asset_class(db, asset_class, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/asset-classes/{asset_class_id}/types",
    response_model=MaintenanceAssetTypeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_asset_type(
    asset_class_id: str,
    payload: MaintenanceAssetTypeCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetTypeRead:
    asset_class = service.get_asset_class_or_404(db, asset_class_id)
    asset_type = service.create_asset_type(
        db,
        asset_class,
        code=payload.code.strip(),
        label=payload.label.strip(),
        icon=payload.icon.strip(),
        tracks_usage_hours=payload.tracks_usage_hours,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già una sottoclasse con questo codice per questa classe.") from exc
    db.refresh(asset_type)
    return serialize_asset_type(asset_type)


@router.patch("/asset-classes/{asset_class_id}/types/reorder", response_model=list[MaintenanceAssetTypeRead])
def reorder_asset_types(
    asset_class_id: str,
    payload: MaintenanceHierarchyReorder,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> list[MaintenanceAssetTypeRead]:
    asset_class = service.get_asset_class_or_404(db, asset_class_id)
    service.reorder_asset_types(db, asset_class, ordered_ids=payload.ordered_ids)
    db.commit()
    db.refresh(asset_class)
    return [serialize_asset_type(item) for item in asset_class.types]


@router.patch("/asset-types/{asset_type_id}", response_model=MaintenanceAssetTypeRead)
def update_asset_type(
    asset_type_id: str,
    payload: MaintenanceAssetTypeUpdate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetTypeRead:
    asset_type = service.get_asset_type_or_404(db, asset_type_id)
    service.update_asset_type(
        db,
        asset_type,
        label=payload.label,
        icon=payload.icon,
        tracks_usage_hours=payload.tracks_usage_hours,
        document_type_options=payload.document_type_options,
        deadline_type_options=payload.deadline_type_options,
    )
    db.commit()
    db.refresh(asset_type)
    return serialize_asset_type(asset_type)


@router.delete("/asset-types/{asset_type_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_type(
    asset_type_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    asset_type = service.get_asset_type_or_404(db, asset_type_id)
    service.delete_asset_type(db, asset_type, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post(
    "/asset-types/{asset_type_id}/fields",
    response_model=MaintenanceAssetTypeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_asset_field(
    asset_type_id: str,
    payload: MaintenanceAssetFieldCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetTypeRead:
    asset_type = service.get_asset_type_or_404(db, asset_type_id)
    service.create_asset_field(
        db,
        asset_type,
        field_key=payload.field_key,
        label=payload.label,
        field_type=payload.field_type,
        is_required=payload.is_required,
        is_searchable=payload.is_searchable,
        options=payload.options,
        sort_order=payload.sort_order,
    )
    db.commit()
    db.refresh(asset_type)
    return serialize_asset_type(asset_type)


@router.post(
    "/asset-classes/{asset_class_id}/fields",
    response_model=MaintenanceAssetClassRead,
    status_code=status.HTTP_201_CREATED,
)
def create_class_field(
    asset_class_id: str,
    payload: MaintenanceAssetFieldCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetClassRead:
    asset_class = service.get_asset_class_or_404(db, asset_class_id)
    service.create_class_field(
        db,
        asset_class,
        field_key=payload.field_key,
        label=payload.label,
        field_type=payload.field_type,
        is_required=payload.is_required,
        is_searchable=payload.is_searchable,
        options=payload.options,
        sort_order=payload.sort_order,
    )
    db.commit()
    db.refresh(asset_class)
    return serialize_asset_class(asset_class)


@router.patch("/asset-fields/{field_id}", response_model=MaintenanceAssetFieldRead)
def update_asset_field(
    field_id: str,
    payload: MaintenanceAssetFieldUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> MaintenanceAssetFieldRead:
    field = service.get_asset_field_or_404(db, field_id)
    service.update_asset_field(
        db,
        field,
        label=payload.label,
        field_type=payload.field_type,
        is_required=payload.is_required,
        is_searchable=payload.is_searchable,
        options=payload.options,
        sort_order=payload.sort_order,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(field)
    return serialize_field(field)


@router.delete("/asset-fields/{field_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_field(
    field_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    field = service.get_asset_field_or_404(db, field_id)
    service.delete_asset_field(db, field, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/assets", response_model=list[MaintenanceAssetRead])
def list_assets(
    asset_type_id: str | None = Query(default=None),
    asset_class_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    status_filter: MaintenanceAssetStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetRead]:
    assets = service.list_assets(
        db,
        asset_type_id=asset_type_id,
        asset_class_id=asset_class_id,
        search=search,
        status_filter=status_filter,
    )
    return serialize_assets(db, assets)


@router.get("/assets/export")
def export_assets(
    asset_type_id: str | None = Query(default=None),
    asset_class_id: str | None = Query(default=None),
    search: str | None = Query(default=None),
    status_filter: MaintenanceAssetStatus | None = Query(default=None, alias="status"),
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> Response:
    assets = service.list_assets(
        db,
        asset_type_id=asset_type_id,
        asset_class_id=asset_class_id,
        search=search,
        status_filter=status_filter,
    )
    content = export_maintenance_assets_xlsx(serialize_assets(db, assets))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="manutenzioni-asset.xlsx"'},
    )


@router.get("/assets/counters/export")
def export_asset_counters(
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> Response:
    content = export_maintenance_asset_counters_xlsx(service.list_all_counter_readings(db))
    return Response(
        content=content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="manutenzioni-ore.xlsx"'},
    )


@router.post("/assets", response_model=MaintenanceAssetRead, status_code=status.HTTP_201_CREATED)
def create_asset(
    payload: MaintenanceAssetCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    asset = service.create_asset(
        db,
        asset_type_id=payload.asset_type_id,
        internal_code=payload.internal_code,
        custom_fields=payload.custom_fields,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Esiste già un asset con questo codice interno: riprova.",
        ) from exc
    db.refresh(asset)
    return serialize_assets(db, [asset], include_last_modified_by=True)[0]


@router.get("/assets/{asset_id}", response_model=MaintenanceAssetRead)
def get_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    return serialize_assets(db, [service.get_asset_or_404(db, asset_id)], include_last_modified_by=True)[0]


def _public_web_base_url() -> str:
    # Stessa logica di services/email._web_base_url: se non è configurata una
    # base web esplicita, si ricava togliendo /api dalla base API pubblica.
    base = settings.public_web_base_url.strip()
    if not base:
        base = settings.public_api_base_url.strip().rstrip("/").removesuffix("/api")
    return base.rstrip("/")


def _serialize_qr_token(asset: MaintenanceAsset) -> MaintenanceAssetQrTokenRead:
    return MaintenanceAssetQrTokenRead(
        asset_id=asset.id,
        qr_token=asset.qr_token,
        # Percorso della pagina pubblica frontend (vedi App.jsx), non
        # l'endpoint API: è quello che finisce codificato nel QR stampato.
        public_url_path=f"/manutenzioni/asset-pubblico/{asset.qr_token}",
    )


@router.get("/assets/{asset_id}/qr-token", response_model=MaintenanceAssetQrTokenRead)
def get_asset_qr_token(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> MaintenanceAssetQrTokenRead:
    asset = service.get_asset_or_404(db, asset_id)
    if asset.qr_token is None:
        raise DomainError("Nessun QR code generato per questo asset.")
    return _serialize_qr_token(asset)


@router.post("/assets/{asset_id}/qr-token/regenerate", response_model=MaintenanceAssetQrTokenRead)
def regenerate_asset_qr_token(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetQrTokenRead:
    asset = service.get_asset_or_404(db, asset_id)
    service.regenerate_qr_token(db, asset, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    db.refresh(asset)
    return _serialize_qr_token(asset)


@router.get("/assets/{asset_id}/qr-token/image")
def get_asset_qr_token_image(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> Response:
    """PNG del QR da stampare sull'etichetta fisica: codifica l'URL pubblico
    completo (dominio compreso), non solo il token, così basta scansionarlo."""
    asset = service.get_asset_or_404(db, asset_id)
    if asset.qr_token is None:
        raise DomainError("Nessun QR code generato per questo asset.")
    public_url = f"{_public_web_base_url()}/manutenzioni/asset-pubblico/{asset.qr_token}"
    image = qrcode.make(public_url)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    return Response(
        content=buffer.getvalue(),
        media_type="image/png",
        headers={"Content-Disposition": f'inline; filename="qr-{asset.internal_code}.png"'},
    )


@router.patch("/assets/{asset_id}", response_model=MaintenanceAssetRead)
def update_asset(
    asset_id: str,
    payload: MaintenanceAssetUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    asset = service.get_asset_or_404(db, asset_id)
    changes = payload.model_dump(exclude_unset=True)
    service.update_asset(db, asset, changes=changes, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    db.refresh(asset)
    return serialize_assets(db, [asset], include_last_modified_by=True)[0]


@router.post("/assets/{asset_id}/custom-fields/{field_key}/image", response_model=MaintenanceAssetRead)
async def upload_asset_image_field(
    asset_id: str,
    field_key: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    asset = service.get_asset_or_404(db, asset_id)
    content = await file.read()
    service.set_image_field(
        db,
        asset,
        field_key=field_key,
        content=content,
        original_filename=file.filename or "immagine",
        mime_type=file.content_type or "application/octet-stream",
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(asset)
    return serialize_assets(db, [asset], include_last_modified_by=True)[0]


@router.delete("/assets/{asset_id}/custom-fields/{field_key}/image", response_model=MaintenanceAssetRead)
def remove_asset_image_field(
    asset_id: str,
    field_key: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    asset = service.get_asset_or_404(db, asset_id)
    service.remove_image_field(
        db,
        asset,
        field_key=field_key,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(asset)
    return serialize_assets(db, [asset], include_last_modified_by=True)[0]


@router.post("/assets/{asset_id}/main-image", response_model=MaintenanceAssetRead)
async def upload_asset_main_image(
    asset_id: str,
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    asset = service.get_asset_or_404(db, asset_id)
    content = await file.read()
    service.set_main_image(
        db,
        asset,
        content=content,
        original_filename=file.filename or "immagine",
        mime_type=file.content_type or "application/octet-stream",
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(asset)
    return serialize_assets(db, [asset], include_last_modified_by=True)[0]


@router.delete("/assets/{asset_id}/main-image", response_model=MaintenanceAssetRead)
def remove_asset_main_image(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetRead:
    asset = service.get_asset_or_404(db, asset_id)
    service.remove_main_image(
        db,
        asset,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(asset)
    return serialize_assets(db, [asset], include_last_modified_by=True)[0]


@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset(
    asset_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    asset = service.get_asset_or_404(db, asset_id)
    service.delete_asset(db, asset, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/assets/{asset_id}/history", response_model=list[MaintenanceAssetHistoryRead])
def get_asset_history(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetHistoryRead]:
    service.get_asset_or_404(db, asset_id)
    return [
        MaintenanceAssetHistoryRead(
            id=item.id,
            changed_field=item.changed_field,
            old_value=item.old_value,
            new_value=item.new_value,
            reason=item.reason,
            changed_by=item.changed_by,
            changed_at=item.changed_at,
        )
        for item in service.list_asset_history(db, asset_id)
    ]


@router.get("/assets/{asset_id}/comments", response_model=list[MaintenanceAssetCommentRead])
def get_asset_comments(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetCommentRead]:
    service.get_asset_or_404(db, asset_id)
    return [
        MaintenanceAssetCommentRead(
            id=item.id,
            text=item.text,
            status=item.status,
            status_reason=item.status_reason,
            created_by=item.created_by,
            created_at=item.created_at,
        )
        for item in service.list_asset_comments(db, asset_id)
    ]


@router.post(
    "/assets/{asset_id}/comments",
    response_model=MaintenanceAssetCommentRead,
    status_code=status.HTTP_201_CREATED,
)
def create_asset_comment(
    asset_id: str,
    payload: MaintenanceAssetCommentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetCommentRead:
    asset = service.get_asset_or_404(db, asset_id)
    comment = service.add_asset_comment(db, asset, text=payload.text, actor_name=current_user.username)
    db.commit()
    db.refresh(comment)
    return MaintenanceAssetCommentRead(
        id=comment.id,
        text=comment.text,
        status=comment.status,
        status_reason=comment.status_reason,
        created_by=comment.created_by,
        created_at=comment.created_at,
    )


@router.get("/assets/{asset_id}/counters", response_model=list[MaintenanceAssetCounterRead])
def get_asset_counters(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetCounterRead]:
    service.get_asset_or_404(db, asset_id)
    return [
        MaintenanceAssetCounterRead(
            id=item.id,
            reading_date=item.reading_date,
            value=float(item.value),
            unit=item.unit,
            recorded_by=item.recorded_by,
            created_at=item.created_at,
        )
        for item in service.list_counter_readings(db, asset_id)
    ]


@router.post(
    "/assets/{asset_id}/counters",
    response_model=MaintenanceAssetCounterRead,
    status_code=status.HTTP_201_CREATED,
)
def create_asset_counter(
    asset_id: str,
    payload: MaintenanceAssetCounterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetCounterRead:
    asset = service.get_asset_or_404(db, asset_id)
    reading = service.add_counter_reading(
        db,
        asset,
        reading_date=payload.reading_date,
        value=payload.value,
        unit=payload.unit,
        actor_name=current_user.username,
    )
    db.commit()
    db.refresh(reading)
    return MaintenanceAssetCounterRead(
        id=reading.id,
        reading_date=reading.reading_date,
        value=float(reading.value),
        unit=reading.unit,
        recorded_by=reading.recorded_by,
        created_at=reading.created_at,
    )


@router.patch("/assets/{asset_id}/counters/{counter_id}", response_model=MaintenanceAssetCounterRead)
def update_asset_counter(
    asset_id: str,
    counter_id: str,
    payload: MaintenanceAssetCounterUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> MaintenanceAssetCounterRead:
    reading = service.get_counter_reading_or_404(db, asset_id, counter_id)
    service.update_counter_reading(
        db,
        reading,
        reading_date=payload.reading_date,
        value=payload.value,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(reading)
    return MaintenanceAssetCounterRead(
        id=reading.id,
        reading_date=reading.reading_date,
        value=float(reading.value),
        unit=reading.unit,
        recorded_by=reading.recorded_by,
        created_at=reading.created_at,
    )


@router.delete("/assets/{asset_id}/counters/{counter_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_asset_counter(
    asset_id: str,
    counter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    reading = service.get_counter_reading_or_404(db, asset_id, counter_id)
    service.delete_counter_reading(db, reading, actor_name=current_user.username, actor_user_id=current_user.id)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

from fastapi import APIRouter, Depends, File, Form, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_maintenance_access
from app.db import get_db
from app.maintenance_asset_models import MaintenanceAssetImage
from app.maintenance_image_schemas import MaintenanceAssetImageDelete, MaintenanceAssetImageRead
from app.models import User
from app.services import maintenance_assets, maintenance_images as service

router = APIRouter(prefix="/maintenance", tags=["maintenance-images"])


def serialize_image(image: MaintenanceAssetImage) -> MaintenanceAssetImageRead:
    return MaintenanceAssetImageRead(
        id=image.id,
        asset_id=image.asset_id,
        image_kind=image.image_kind,
        slot_key=image.slot_key,
        title=image.title,
        original_filename=image.original_filename,
        mime_type=image.mime_type,
        size_bytes=image.size_bytes,
        uploaded_by=image.uploaded_by,
        created_at=image.created_at,
        updated_at=image.updated_at,
    )


@router.get("/assets/{asset_id}/photos", response_model=list[MaintenanceAssetImageRead])
def list_photos(
    asset_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceAssetImageRead]:
    maintenance_assets.get_asset_or_404(db, asset_id)
    return [serialize_image(image) for image in service.list_gallery_images(db, asset_id)]


@router.post(
    "/assets/{asset_id}/photos",
    response_model=MaintenanceAssetImageRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_photo(
    asset_id: str,
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceAssetImageRead:
    asset = maintenance_assets.get_asset_or_404(db, asset_id)
    image = service.add_gallery_image(
        db,
        asset,
        title=title.strip(),
        content=await file.read(),
        original_filename=file.filename or "foto",
        mime_type=file.content_type or "application/octet-stream",
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(image)
    return serialize_image(image)


@router.get("/images/{image_id}/content")
def get_image_content(
    image_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> Response:
    image = service.get_image_or_404(db, image_id)
    return Response(content=service.read_image(image), media_type=image.mime_type)


@router.delete("/images/{image_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_image(
    image_id: str,
    payload: MaintenanceAssetImageDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    image = service.get_image_or_404(db, image_id)
    service.delete_image(
        db,
        image,
        reason=payload.reason,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

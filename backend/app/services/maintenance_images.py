"""Immagini anagrafiche degli asset, con contenuto su SMB.

Foto principale, campi immagine tecnici e galleria condividono lo storage,
ma non il ciclo documentale di versioni/stati previsto per certificati e report.
"""

from __future__ import annotations

import logging
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.maintenance_asset_models import MaintenanceAsset, MaintenanceAssetImage
from app.services import smb_storage
from app.services.audit import record_audit_log
from app.services.errors import DomainError

logger = logging.getLogger(__name__)

ALLOWED_IMAGE_EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
MAX_IMAGE_SIZE_BYTES = 25 * 1024 * 1024


def _validate_image(content: bytes, mime_type: str) -> str:
    extension = ALLOWED_IMAGE_EXTENSIONS.get(mime_type)
    if extension is None:
        raise DomainError("Formato immagine non ammesso: solo JPEG o PNG.")
    if not content:
        raise DomainError("Il file è vuoto.")
    if len(content) > MAX_IMAGE_SIZE_BYTES:
        raise DomainError(f"Immagine troppo grande: il limite è {MAX_IMAGE_SIZE_BYTES // (1024 * 1024)} MB.")
    return extension


def set_image(
    db: Session,
    asset: MaintenanceAsset,
    *,
    image_kind: str,
    slot_key: str,
    title: str,
    content: bytes,
    original_filename: str,
    mime_type: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAssetImage:
    if image_kind not in {"main", "technical", "gallery"}:
        raise DomainError("Tipo immagine non riconosciuto.")
    extension = _validate_image(content, mime_type)
    existing = db.scalar(
        select(MaintenanceAssetImage).where(
            MaintenanceAssetImage.asset_id == asset.id,
            MaintenanceAssetImage.image_kind == image_kind,
            MaintenanceAssetImage.slot_key == slot_key,
        )
    )
    image = existing or MaintenanceAssetImage(
        id=str(uuid4()),
        asset_id=asset.id,
        image_kind=image_kind,
        slot_key=slot_key,
        title=title,
        file_path="",
        original_filename=original_filename,
        mime_type=mime_type,
        size_bytes=len(content),
        uploaded_by=actor_name,
    )
    old_path = image.file_path or None
    relative_path = f"assets/{asset.id}/images/{uuid4()}{extension}"

    # Prima si salva il nuovo contenuto: un errore SMB non deve eliminare
    # l'immagine precedente né lasciare metadati che puntano al nulla.
    smb_storage.write_image(relative_path, content)
    image.title = title
    image.file_path = relative_path
    image.original_filename = original_filename
    image.mime_type = mime_type
    image.size_bytes = len(content)
    image.uploaded_by = actor_name
    if existing is None:
        db.add(image)
    db.flush()

    if old_path and old_path != relative_path:
        try:
            smb_storage.delete_image(old_path)
        except DomainError:
            logger.warning("Vecchia immagine non rimossa da SMB: %s", old_path)

    record_audit_log(
        db,
        action="replace" if existing else "upload",
        entity="maintenance_asset_image",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": image.id, "asset_id": asset.id, "image_kind": image_kind, "slot_key": slot_key},
    )
    return image


def add_gallery_image(
    db: Session,
    asset: MaintenanceAsset,
    *,
    title: str,
    content: bytes,
    original_filename: str,
    mime_type: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAssetImage:
    image_id = str(uuid4())
    return set_image(
        db,
        asset,
        image_kind="gallery",
        slot_key=image_id,
        title=title,
        content=content,
        original_filename=original_filename,
        mime_type=mime_type,
        actor_name=actor_name,
        actor_user_id=actor_user_id,
    )


def list_gallery_images(db: Session, asset_id: str) -> list[MaintenanceAssetImage]:
    statement = (
        select(MaintenanceAssetImage)
        .where(
            MaintenanceAssetImage.asset_id == asset_id,
            MaintenanceAssetImage.image_kind == "gallery",
        )
        .order_by(MaintenanceAssetImage.created_at.desc())
    )
    return list(db.scalars(statement).all())


def get_slot_image(db: Session, asset_id: str, image_kind: str, slot_key: str) -> MaintenanceAssetImage | None:
    return db.scalar(
        select(MaintenanceAssetImage).where(
            MaintenanceAssetImage.asset_id == asset_id,
            MaintenanceAssetImage.image_kind == image_kind,
            MaintenanceAssetImage.slot_key == slot_key,
        )
    )


def image_ids_by_asset(db: Session, asset_ids: list[str]) -> dict[str, dict[str, object]]:
    result: dict[str, dict[str, object]] = {
        asset_id: {"main_image_id": None, "image_field_ids": {}}
        for asset_id in asset_ids
    }
    if not asset_ids:
        return result
    images = db.scalars(
        select(MaintenanceAssetImage).where(
            MaintenanceAssetImage.asset_id.in_(asset_ids),
            MaintenanceAssetImage.image_kind.in_(("main", "technical")),
        )
    ).all()
    for image in images:
        payload = result[image.asset_id]
        if image.image_kind == "main":
            payload["main_image_id"] = image.id
        else:
            payload["image_field_ids"][image.slot_key] = image.id  # type: ignore[index]
    return result


def list_images_for_asset(db: Session, asset_id: str) -> list[MaintenanceAssetImage]:
    """Tutte le immagini dell'asset (principale, campi tecnici, galleria):
    usata dalla pagina pubblica del QR, che a differenza della scheda
    autenticata mostra tutto insieme invece che per slot."""
    statement = (
        select(MaintenanceAssetImage)
        .where(MaintenanceAssetImage.asset_id == asset_id)
        .order_by(MaintenanceAssetImage.image_kind, MaintenanceAssetImage.created_at)
    )
    return list(db.scalars(statement).all())


def get_image_or_404(db: Session, image_id: str) -> MaintenanceAssetImage:
    image = db.get(MaintenanceAssetImage, image_id)
    if image is None:
        raise DomainError("Immagine non trovata.")
    return image


def read_image(image: MaintenanceAssetImage) -> bytes:
    return smb_storage.read_image(image.file_path)


def delete_image(
    db: Session,
    image: MaintenanceAssetImage,
    *,
    actor_name: str | None,
    actor_user_id: str | None,
    reason: str | None = None,
) -> None:
    smb_storage.delete_image(image.file_path)
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset_image",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": image.id, "asset_id": image.asset_id, "image_kind": image.image_kind, "reason": reason},
    )
    db.delete(image)


def delete_images_for_asset(db: Session, asset_id: str) -> None:
    images = list(db.scalars(select(MaintenanceAssetImage).where(MaintenanceAssetImage.asset_id == asset_id)))
    for image in images:
        try:
            smb_storage.delete_image(image.file_path)
        except DomainError:
            logger.warning("Immagine non rimossa da SMB durante l'eliminazione asset: %s", image.id)
        db.delete(image)

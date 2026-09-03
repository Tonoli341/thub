from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin, require_maintenance_access
from app.db import get_db
from app.maintenance_asset_models import MaintenanceDocument
from app.maintenance_document_schemas import (
    MaintenanceDocumentDelete,
    MaintenanceDocumentRead,
    MaintenanceDocumentStatusUpdate,
)
from app.models import User
from app.services import maintenance_assets, maintenance_documents as service

router = APIRouter(prefix="/maintenance", tags=["maintenance-documents"])


def serialize_document(document: MaintenanceDocument) -> MaintenanceDocumentRead:
    return MaintenanceDocumentRead(
        id=document.id,
        asset_id=document.asset_id,
        doc_type=document.doc_type,
        title=document.title,
        is_photo=document.is_photo,
        status=document.status,
        original_filename=document.original_filename,
        mime_type=document.mime_type,
        size_bytes=document.size_bytes,
        uploaded_by=document.uploaded_by,
        created_at=document.created_at,
    )


@router.get("/assets/{asset_id}/documents", response_model=list[MaintenanceDocumentRead])
def list_documents(
    asset_id: str,
    include_obsolete: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> list[MaintenanceDocumentRead]:
    maintenance_assets.get_asset_or_404(db, asset_id)
    return [serialize_document(item) for item in service.list_documents(db, asset_id, include_obsolete=include_obsolete, is_photo=False)]


@router.post(
    "/assets/{asset_id}/documents",
    response_model=MaintenanceDocumentRead,
    status_code=status.HTTP_201_CREATED,
)
async def upload_document(
    asset_id: str,
    doc_type: str = Form(...),
    title: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceDocumentRead:
    asset = maintenance_assets.get_asset_or_404(db, asset_id)
    content = await file.read()
    document = service.upload_document(
        db,
        asset,
        doc_type=doc_type.strip(),
        title=title.strip(),
        content=content,
        original_filename=file.filename or "documento",
        mime_type=file.content_type or "application/octet-stream",
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(document)
    return serialize_document(document)


@router.patch("/documents/{document_id}/status", response_model=MaintenanceDocumentRead)
def update_document_status(
    document_id: str,
    payload: MaintenanceDocumentStatusUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> MaintenanceDocumentRead:
    document = service.get_document_or_404(db, document_id)
    service.set_document_status(
        db,
        document,
        new_status=payload.status,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    db.refresh(document)
    return serialize_document(document)


@router.get("/documents/{document_id}/download")
def download_document(
    document_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> Response:
    document = service.get_document_or_404(db, document_id)
    content = service.download_document(document)
    return Response(
        content=content,
        media_type=document.mime_type,
        headers={"Content-Disposition": f'attachment; filename="{document.original_filename}"'},
    )


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_document(
    document_id: str,
    payload: MaintenanceDocumentDelete,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Response:
    document = service.get_document_or_404(db, document_id)
    service.delete_document(
        db,
        document,
        reason=payload.reason,
        actor_name=current_user.username,
        actor_user_id=current_user.id,
    )
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

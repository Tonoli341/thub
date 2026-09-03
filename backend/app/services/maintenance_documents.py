"""Documenti del modulo Manutenzioni, su file server SMB (§11 del documento
requisiti).

Niente versionamento automatico: più documenti dello stesso doc_type possono
restare "rilasciato" insieme, e lo stato (rilasciato/obsoleto) si cambia solo
a mano con `set_document_status`. L'eliminazione definitiva è un'operazione
distinta, tracciata con data/utente/motivazione, e cancella anche il file
fisico sulla condivisione.
"""

from __future__ import annotations

from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.enums import MaintenanceDocumentStatus
from app.maintenance_asset_models import MaintenanceAsset, MaintenanceDocument
from app.services import smb_storage
from app.services.audit import record_audit_log
from app.services.errors import DomainError
from app.services.timeutils import now_local

ALLOWED_MIME_EXTENSIONS = {
    "application/pdf": ".pdf",
    "image/jpeg": ".jpg",
    "image/png": ".png",
}
# Il questionario indicava ~300KB come limite: era la dimensione tipica dei PDF
# testuali osservati, non un vincolo da imporre — scansioni di certificati e
# foto di targhe CE lo superano di norma. Qui su file server, non a database,
# non c'è motivo di restare così bassi.
MAX_DOCUMENT_SIZE_BYTES = 25 * 1024 * 1024


def upload_document(
    db: Session,
    asset: MaintenanceAsset,
    *,
    doc_type: str,
    title: str,
    content: bytes,
    original_filename: str,
    mime_type: str,
    actor_name: str | None,
    actor_user_id: str | None,
    is_photo: bool = False,
) -> MaintenanceDocument:
    if mime_type not in ALLOWED_MIME_EXTENSIONS:
        raise DomainError("Formato file non ammesso: solo PDF, JPEG o PNG.")
    if len(content) > MAX_DOCUMENT_SIZE_BYTES:
        raise DomainError(f"File troppo grande: il limite è {MAX_DOCUMENT_SIZE_BYTES // (1024 * 1024)} MB.")
    if not content:
        raise DomainError("Il file è vuoto.")
    # Le foto (§3: allegati di anagrafica, non documenti) non passano dalla
    # value list document_type_options della sottoclasse: quella lista è
    # pensata per certificati/collaudi, non per un caricamento libero di foto.
    if not is_photo and doc_type not in asset.asset_type.document_type_options:
        raise DomainError(f"Tipo documento «{doc_type}» non riconosciuto per questa sottoclasse: sceglilo dall'elenco.")

    document_id = str(uuid4())
    extension = ALLOWED_MIME_EXTENSIONS[mime_type]
    relative_path = f"{asset.id}/{document_id}{extension}"

    # Scrive il file prima di toccare il database: se la condivisione non è
    # raggiungibile, non deve restare un documento "rilasciato" senza contenuto.
    smb_storage.write_document(relative_path, content)

    document = MaintenanceDocument(
        id=document_id,
        asset_id=asset.id,
        doc_type=doc_type,
        title=title,
        status=MaintenanceDocumentStatus.rilasciato,
        file_path=relative_path,
        original_filename=original_filename,
        mime_type=mime_type,
        size_bytes=len(content),
        uploaded_by=actor_name,
    )
    db.add(document)
    db.flush()

    record_audit_log(
        db,
        action="upload",
        entity="maintenance_document",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": document.id, "asset_id": asset.id, "doc_type": doc_type},
    )
    return document


def set_document_status(
    db: Session,
    document: MaintenanceDocument,
    *,
    new_status: MaintenanceDocumentStatus,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceDocument:
    old_status = document.status
    document.status = new_status
    record_audit_log(
        db,
        action="status_change",
        entity="maintenance_document",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": document.id, "asset_id": document.asset_id, "old_status": old_status.value, "new_status": new_status.value},
    )
    return document


def list_documents(db: Session, asset_id: str, *, include_obsolete: bool = False, is_photo: bool = False) -> list[MaintenanceDocument]:
    statement = select(MaintenanceDocument).where(
        MaintenanceDocument.asset_id == asset_id,
        MaintenanceDocument.deleted_at.is_(None),
        MaintenanceDocument.is_photo.is_(is_photo),
    )
    if not is_photo:
        # Le immagini tecniche create prima di 0019 avevano un doc_type
        # riservato: non devono comparire nell'archivio documentale.
        statement = statement.where(MaintenanceDocument.doc_type.not_like("attributo:%"))
    if not include_obsolete:
        statement = statement.where(MaintenanceDocument.status == MaintenanceDocumentStatus.rilasciato)
    if is_photo:
        statement = statement.order_by(MaintenanceDocument.created_at.desc())
    else:
        statement = statement.order_by(MaintenanceDocument.doc_type.asc(), MaintenanceDocument.created_at.desc())
    return list(db.scalars(statement).all())


def get_document_or_404(db: Session, document_id: str) -> MaintenanceDocument:
    document = db.get(MaintenanceDocument, document_id)
    if document is None or document.deleted_at is not None:
        raise DomainError("Documento non trovato.")
    return document


def download_document(document: MaintenanceDocument) -> bytes:
    return smb_storage.read_document(document.file_path)


def delete_document(
    db: Session,
    document: MaintenanceDocument,
    *,
    reason: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> None:
    smb_storage.delete_document(document.file_path)

    document.deleted_at = now_local()
    document.deleted_by = actor_name
    document.deletion_reason = reason

    asset = db.get(MaintenanceAsset, document.asset_id)
    if asset is not None and asset.main_image_document_id == document.id:
        asset.main_image_document_id = None

    record_audit_log(
        db,
        action="delete",
        entity="maintenance_document",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": document.id, "asset_id": document.asset_id, "reason": reason},
    )

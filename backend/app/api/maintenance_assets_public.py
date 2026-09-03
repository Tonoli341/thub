"""Pagina pubblica raggiunta scansionando il QR code fisico di un asset.

Eccezione registrata su api_router (non protected_router, vedi
app/api/__init__.py): un tecnico sul campo la apre dal telefono senza login,
scansionando l'etichetta attaccata all'asset. Il token è imprevedibile
(secrets.token_urlsafe) e rigenerabile da un admin, quindi un'etichetta
smarrita o rimossa da un asset dismesso si invalida rigenerando.

Revisione del 2026-09-03 (vedi manutenzioni.md §18): la prima versione
esponeva solo codice interno, categoria, stato e scadenze. La richiesta
esplicita e confermata è di allargare la pagina a tutta l'anagrafica
(custom_fields con nomi risolti, foto, storico contaore) e all'elenco dei
documenti limitato a tipo e note — mai id, nome file o contenuto. Include
inoltre testo, autore e data delle note libere dell'asset, senza id o
metadati dello snapshot di stato. Ogni lookup di dettaglio (immagini incluse)
deve passare dal token: non c'è nessun endpoint pubblico che accetti un
asset_id o un image_id senza prima verificarne l'appartenenza all'asset del
token, altrimenti la pagina pubblica diventerebbe un modo per enumerare dati
di ALTRI asset.
"""

from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.maintenance_asset_schemas import (
    MaintenanceAssetPublicCounterRead,
    MaintenanceAssetPublicDocumentRead,
    MaintenanceAssetPublicFieldRead,
    MaintenanceAssetPublicImageRead,
    MaintenanceAssetPublicNoteRead,
    MaintenanceAssetPublicRead,
    MaintenanceDeadlinePublicRead,
)
from app.services import maintenance_assets as service
from app.services import maintenance_deadlines as deadlines_service
from app.services import maintenance_documents
from app.services import maintenance_images
from app.services.errors import DomainError

router = APIRouter(prefix="/maintenance/assets/public", tags=["maintenance-assets-public"])


@router.get("/{token}", response_model=MaintenanceAssetPublicRead)
def get_public_asset(token: str, db: Session = Depends(get_db)) -> MaintenanceAssetPublicRead:
    asset = service.get_asset_by_qr_token_or_404(db, token)
    asset_type = asset.asset_type
    deadlines = deadlines_service.list_deadlines(db, asset_id=asset.id, active_only=True)
    images = maintenance_images.list_images_for_asset(db, asset.id)
    documents = maintenance_documents.list_documents(db, asset.id)
    notes = service.list_asset_comments(db, asset.id)
    counters = service.list_counter_readings(db, asset.id) if asset_type.tracks_usage_hours else []
    return MaintenanceAssetPublicRead(
        internal_code=asset.internal_code,
        asset_type_label=asset_type.label,
        asset_class_label=asset_type.asset_class.label,
        status=asset.status,
        status_reason=asset.status_reason,
        deadlines=[
            MaintenanceDeadlinePublicRead(
                deadline_type=deadline.deadline_type,
                due_date=deadline.due_date,
                is_active=deadline.is_active,
            )
            for deadline in deadlines
        ],
        custom_field_values=[
            MaintenanceAssetPublicFieldRead(**field) for field in service.public_field_values(db, asset)
        ],
        images=[
            MaintenanceAssetPublicImageRead(
                id=image.id,
                image_kind=image.image_kind,
                slot_key=image.slot_key,
                title=image.title,
            )
            for image in images
        ],
        documents=[
            MaintenanceAssetPublicDocumentRead(
                document_type=document.doc_type,
                notes=document.title,
            )
            for document in documents
        ],
        notes=[
            MaintenanceAssetPublicNoteRead(
                text=note.text,
                created_by=note.created_by,
                created_at=note.created_at,
            )
            for note in notes
        ],
        counters=[
            MaintenanceAssetPublicCounterRead(
                reading_date=reading.reading_date,
                value=reading.value,
                unit=reading.unit,
            )
            for reading in counters
        ],
    )


@router.get("/{token}/images/{image_id}")
def get_public_asset_image(token: str, image_id: str, db: Session = Depends(get_db)) -> Response:
    asset = service.get_asset_by_qr_token_or_404(db, token)
    image = maintenance_images.get_image_or_404(db, image_id)
    # Verifica di appartenenza: senza questo controllo un token valido di UN
    # asset basterebbe a leggere le foto di un asset qualunque, indovinando
    # solo l'id immagine (non protetto da segreto quanto il token).
    if image.asset_id != asset.id:
        raise DomainError("Immagine non trovata.")
    return Response(content=maintenance_images.read_image(image), media_type=image.mime_type)

"""Amministrazione delle integrazioni esterne (Configurazione › Integrazioni).

Solo admin. Il client secret entra ma non esce mai: la GET ne restituisce
soltanto la coda, e una PUT che non lo include lascia invariato quello salvato.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.db import get_db
from app.models import AppSetting, User
from app.schemas import Office365IntegrationRead, Office365IntegrationUpdate
from app.services.audit import record_audit_log
from app.services.crypto import encryption_available, secret_hint
from app.services.graph_oof import invalidate_token_cache
from app.services.integrations import (
    OFFICE365_ENABLED,
    Office365Config,
    get_office365_config,
    save_office365_config,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system/integrations", tags=["integrations"], dependencies=[Depends(require_admin)])


def _serialize(db: Session, config: Office365Config) -> Office365IntegrationRead:
    # L'interruttore generale è la riga che viene sempre scritta per prima:
    # la sua data di aggiornamento è la data dell'ultima modifica alla scheda.
    marker = db.get(AppSetting, OFFICE365_ENABLED)
    return Office365IntegrationRead(
        enabled=config.enabled,
        oof_enabled=config.oof_enabled,
        tenant_id=config.tenant_id,
        client_id=config.client_id,
        client_secret_set=bool(config.client_secret),
        client_secret_hint=secret_hint(config.client_secret),
        oof_use_manager=config.oof_use_manager,
        oof_fallback_contact=config.oof_fallback_contact,
        credentials_complete=config.credentials_complete,
        oof_active=config.oof_active,
        encryption_available=encryption_available(),
        updated_at=marker.updated_at if marker else None,
        updated_by=marker.updated_by if marker else None,
    )


@router.get("/office365", response_model=Office365IntegrationRead)
def read_office365_integration(db: Session = Depends(get_db)) -> Office365IntegrationRead:
    return _serialize(db, get_office365_config(db))


@router.put("/office365", response_model=Office365IntegrationRead)
def update_office365_integration(
    payload: Office365IntegrationUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
) -> Office365IntegrationRead:
    # Meglio rifiutare il salvataggio che scrivere un segreto in chiaro.
    if payload.client_secret and not encryption_available():
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Cifratura non disponibile sul backend: ricostruire l'immagine prima di salvare il client secret.",
        )

    previous = get_office365_config(db)
    config = save_office365_config(
        db,
        enabled=payload.enabled,
        oof_enabled=payload.oof_enabled,
        tenant_id=payload.tenant_id,
        client_id=payload.client_id,
        client_secret=payload.client_secret,
        oof_use_manager=payload.oof_use_manager,
        oof_fallback_contact=payload.oof_fallback_contact,
        actor=current_user.username,
    )
    # Accendere o spegnere un'integrazione che scrive sulle caselle aziendali è
    # un'azione che deve lasciare traccia; il segreto non finisce nell'audit.
    record_audit_log(
        db,
        action="update",
        entity="integration_office365",
        actor_name=current_user.username,
        detail={
            "enabled": {"before": previous.enabled, "after": config.enabled},
            "oof_enabled": {"before": previous.oof_enabled, "after": config.oof_enabled},
            "tenant_id": {"before": previous.tenant_id, "after": config.tenant_id},
            "client_id": {"before": previous.client_id, "after": config.client_id},
            "client_secret_changed": payload.client_secret is not None,
            "oof_use_manager": {"before": previous.oof_use_manager, "after": config.oof_use_manager},
            "oof_fallback_contact": {"before": previous.oof_fallback_contact, "after": config.oof_fallback_contact},
        },
    )
    db.commit()
    # Credenziali cambiate o integrazione spenta: il token in cache non va riusato.
    invalidate_token_cache()
    logger.info("Integrazione Microsoft 365 aggiornata da %s (attiva=%s).", current_user.username, config.enabled)
    return _serialize(db, get_office365_config(db))

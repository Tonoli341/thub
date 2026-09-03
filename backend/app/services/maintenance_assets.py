"""Anagrafica del modulo Manutenzioni — fase 1 (pilota carrelli elevatori).

Gerarchia: Classe (es. "Carrelli elevatori", poche voci, stabili) ->
Sottoclasse (es. "Frontale", "Retrattile", configurabile liberamente da
Operations) -> asset singolo. I campi configurabili e gli asset si agganciano
alla sottoclasse, non alla classe: in pratica gli attributi rilevanti
cambiano anche all'interno della stessa classe.

Ogni cambio di sede, reparto, responsabile o stato viene registrato in
MaintenanceAssetHistory (§5 e §13 del documento requisiti): un valore
superato non si sovrascrive, si registra.

Visibilità per sito: non implementata in questa fase. Chiunque abbia
can_access_maintenance vede tutti gli asset di tutti i siti — decisione
esplicita della proposta di fase 1, perché oggi in T-Hub non esiste
un'assegnazione utente↔sito riutilizzabile (il modello Site è scollegato).
"""

from __future__ import annotations

import logging
import secrets

from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.maintenance_asset_models import (
    MaintenanceAsset,
    MaintenanceAssetClass,
    MaintenanceAssetComment,
    MaintenanceAssetCounter,
    MaintenanceAssetField,
    MaintenanceAssetFamily,
    MaintenanceAssetHistory,
    MaintenanceAssetType,
    MaintenanceDeadline,
    MaintenanceDeadlineAck,
    MaintenanceDocument,
    MaintenanceNotificationRule,
)
from app.models import AuditLog, Employee
from app.services import maintenance_images, smb_storage
from app.services.audit import record_audit_log
from app.services.errors import DomainError

logger = logging.getLogger(__name__)


def list_asset_families(db: Session) -> list[MaintenanceAssetFamily]:
    statement = (
        select(MaintenanceAssetFamily)
        .where(MaintenanceAssetFamily.is_active.is_(True))
        .options(
            selectinload(MaintenanceAssetFamily.classes)
            .selectinload(MaintenanceAssetClass.types)
            .selectinload(MaintenanceAssetType.fields)
        )
        .order_by(MaintenanceAssetFamily.sort_order.asc())
    )
    return list(db.scalars(statement).all())


def get_asset_family_or_404(db: Session, asset_family_id: str) -> MaintenanceAssetFamily:
    asset_family = db.get(MaintenanceAssetFamily, asset_family_id)
    if asset_family is None:
        raise DomainError("Famiglia di asset non trovata.")
    return asset_family


def _next_sort_order(db: Session, model, **scope_filters) -> int:
    statement = select(func.max(model.sort_order)).filter_by(**scope_filters)
    current_max = db.scalar(statement)
    return (current_max or 0) + 1 if current_max is not None else 0


def create_asset_family(db: Session, *, code: str, label: str, icon: str = "tools") -> MaintenanceAssetFamily:
    if db.scalar(select(MaintenanceAssetFamily).where(MaintenanceAssetFamily.code == code)) is not None:
        raise DomainError(f"La famiglia «{code}» esiste già.")
    asset_family = MaintenanceAssetFamily(
        code=code, label=label, icon=icon, sort_order=_next_sort_order(db, MaintenanceAssetFamily)
    )
    db.add(asset_family)
    db.flush()
    return asset_family


def reorder_asset_families(db: Session, *, ordered_ids: list[str]) -> list[MaintenanceAssetFamily]:
    families = list(db.scalars(select(MaintenanceAssetFamily).where(MaintenanceAssetFamily.id.in_(ordered_ids))).all())
    by_id = {family.id: family for family in families}
    if set(by_id) != set(ordered_ids):
        raise DomainError("L'elenco di riordino non corrisponde esattamente alle famiglie esistenti.")
    for index, family_id in enumerate(ordered_ids):
        by_id[family_id].sort_order = index
    db.flush()
    return families


def update_asset_family(db: Session, asset_family: MaintenanceAssetFamily, *, label: str | None, icon: str | None) -> MaintenanceAssetFamily:
    if label:
        asset_family.label = label
    if icon:
        asset_family.icon = icon
    db.flush()
    return asset_family


def delete_asset_family(db: Session, asset_family: MaintenanceAssetFamily, *, actor_name: str | None, actor_user_id: str | None) -> None:
    asset_count = db.scalar(
        select(MaintenanceAsset)
        .join(MaintenanceAssetType, MaintenanceAsset.asset_type_id == MaintenanceAssetType.id)
        .join(MaintenanceAssetClass, MaintenanceAssetType.asset_class_id == MaintenanceAssetClass.id)
        .where(MaintenanceAssetClass.family_id == asset_family.id)
        .limit(1)
    )
    if asset_count is not None:
        raise DomainError("Non puoi eliminare una famiglia che ha ancora asset collegati: spostali o eliminali prima.")
    rule_count = db.scalar(
        select(MaintenanceNotificationRule)
        .join(MaintenanceAssetClass, MaintenanceNotificationRule.asset_class_id == MaintenanceAssetClass.id)
        .where(MaintenanceAssetClass.family_id == asset_family.id)
        .limit(1)
    )
    if rule_count is not None:
        raise DomainError(
            "Non puoi eliminare una famiglia le cui classi hanno ancora regole di notifica collegate: rimuovile prima."
        )
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset_family",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset_family.id, "code": asset_family.code},
    )
    db.delete(asset_family)


def list_asset_classes(db: Session) -> list[MaintenanceAssetClass]:
    statement = (
        select(MaintenanceAssetClass)
        .where(MaintenanceAssetClass.is_active.is_(True))
        .options(
            selectinload(MaintenanceAssetClass.fields),
            selectinload(MaintenanceAssetClass.types).selectinload(MaintenanceAssetType.fields),
        )
        .order_by(MaintenanceAssetClass.sort_order.asc())
    )
    return list(db.scalars(statement).all())


def get_asset_class_or_404(db: Session, asset_class_id: str) -> MaintenanceAssetClass:
    asset_class = db.get(MaintenanceAssetClass, asset_class_id)
    if asset_class is None:
        raise DomainError("Classe di asset non trovata.")
    return asset_class


def create_asset_class(
    db: Session, asset_family: MaintenanceAssetFamily, *, code: str, label: str, icon: str = "tools"
) -> MaintenanceAssetClass:
    if db.scalar(select(MaintenanceAssetClass).where(MaintenanceAssetClass.code == code)) is not None:
        raise DomainError(f"La classe «{code}» esiste già.")
    asset_class = MaintenanceAssetClass(
        family_id=asset_family.id,
        code=code,
        label=label,
        icon=icon,
        sort_order=_next_sort_order(db, MaintenanceAssetClass, family_id=asset_family.id),
    )
    db.add(asset_class)
    db.flush()
    return asset_class


def reorder_asset_classes(
    db: Session, asset_family: MaintenanceAssetFamily, *, ordered_ids: list[str]
) -> list[MaintenanceAssetClass]:
    classes = list(
        db.scalars(
            select(MaintenanceAssetClass).where(
                MaintenanceAssetClass.family_id == asset_family.id,
                MaintenanceAssetClass.id.in_(ordered_ids),
            )
        ).all()
    )
    by_id = {asset_class.id: asset_class for asset_class in classes}
    if set(by_id) != set(ordered_ids):
        raise DomainError("L'elenco di riordino non corrisponde esattamente alle classi di questa famiglia.")
    for index, class_id in enumerate(ordered_ids):
        by_id[class_id].sort_order = index
    db.flush()
    return classes


def update_asset_class(db: Session, asset_class: MaintenanceAssetClass, *, label: str | None, icon: str | None) -> MaintenanceAssetClass:
    if label:
        asset_class.label = label
    if icon:
        asset_class.icon = icon
    db.flush()
    return asset_class


def delete_asset_class(db: Session, asset_class: MaintenanceAssetClass, *, actor_name: str | None, actor_user_id: str | None) -> None:
    asset_count = db.scalar(
        select(MaintenanceAsset)
        .join(MaintenanceAssetType, MaintenanceAsset.asset_type_id == MaintenanceAssetType.id)
        .where(MaintenanceAssetType.asset_class_id == asset_class.id)
        .limit(1)
    )
    if asset_count is not None:
        raise DomainError("Non puoi eliminare una classe che ha ancora asset collegati: spostali o eliminali prima.")
    rule_count = db.scalar(
        select(MaintenanceNotificationRule).where(MaintenanceNotificationRule.asset_class_id == asset_class.id).limit(1)
    )
    if rule_count is not None:
        raise DomainError("Non puoi eliminare una classe che ha ancora regole di notifica collegate: rimuovile prima.")
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset_class",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset_class.id, "code": asset_class.code},
    )
    db.delete(asset_class)


def get_asset_type_or_404(db: Session, asset_type_id: str) -> MaintenanceAssetType:
    asset_type = db.get(
        MaintenanceAssetType,
        asset_type_id,
        options=[
            selectinload(MaintenanceAssetType.fields),
            selectinload(MaintenanceAssetType.asset_class).selectinload(MaintenanceAssetClass.fields),
        ],
    )
    if asset_type is None:
        raise DomainError("Sottoclasse di asset non trovata.")
    return asset_type


def create_asset_type(
    db: Session,
    asset_class: MaintenanceAssetClass,
    *,
    code: str,
    label: str,
    icon: str = "tools",
    tracks_usage_hours: bool = False,
) -> MaintenanceAssetType:
    existing = db.scalar(
        select(MaintenanceAssetType).where(
            MaintenanceAssetType.asset_class_id == asset_class.id,
            MaintenanceAssetType.code == code,
        )
    )
    if existing is not None:
        raise DomainError(f"La sottoclasse «{code}» esiste già per questa classe.")
    asset_type = MaintenanceAssetType(
        asset_class_id=asset_class.id,
        code=code,
        label=label,
        icon=icon,
        tracks_usage_hours=tracks_usage_hours,
        sort_order=_next_sort_order(db, MaintenanceAssetType, asset_class_id=asset_class.id),
    )
    db.add(asset_type)
    db.flush()
    return asset_type


def reorder_asset_types(
    db: Session, asset_class: MaintenanceAssetClass, *, ordered_ids: list[str]
) -> list[MaintenanceAssetType]:
    types = list(
        db.scalars(
            select(MaintenanceAssetType).where(
                MaintenanceAssetType.asset_class_id == asset_class.id,
                MaintenanceAssetType.id.in_(ordered_ids),
            )
        ).all()
    )
    by_id = {asset_type.id: asset_type for asset_type in types}
    if set(by_id) != set(ordered_ids):
        raise DomainError("L'elenco di riordino non corrisponde esattamente alle sottoclassi di questa classe.")
    for index, type_id in enumerate(ordered_ids):
        by_id[type_id].sort_order = index
    db.flush()
    return types


def update_asset_type(
    db: Session,
    asset_type: MaintenanceAssetType,
    *,
    label: str | None,
    icon: str | None,
    tracks_usage_hours: bool | None = None,
    document_type_options: list[str] | None = None,
    deadline_type_options: list[str] | None = None,
) -> MaintenanceAssetType:
    if label:
        asset_type.label = label
    if icon:
        asset_type.icon = icon
    if tracks_usage_hours is not None:
        asset_type.tracks_usage_hours = tracks_usage_hours
    if document_type_options is not None:
        asset_type.document_type_options = document_type_options
    if deadline_type_options is not None:
        asset_type.deadline_type_options = deadline_type_options
    db.flush()
    return asset_type


def delete_asset_type(db: Session, asset_type: MaintenanceAssetType, *, actor_name: str | None, actor_user_id: str | None) -> None:
    asset_count = db.scalar(
        select(MaintenanceAsset).where(MaintenanceAsset.asset_type_id == asset_type.id).limit(1)
    )
    if asset_count is not None:
        raise DomainError("Non puoi eliminare una sottoclasse che ha ancora asset collegati: spostali o eliminali prima.")
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset_type",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset_type.id, "code": asset_type.code, "asset_class_id": asset_type.asset_class_id},
    )
    db.delete(asset_type)


def create_asset_field(
    db: Session,
    asset_type: MaintenanceAssetType,
    *,
    field_key: str,
    label: str,
    field_type,
    is_required: bool,
    is_searchable: bool,
    options: list[str],
    sort_order: int,
) -> MaintenanceAssetField:
    """Crea un attributo a livello di sottoclasse (varia anche all'interno
    della stessa classe, es. portata/montante del carrello frontale)."""
    if any(field.field_key == field_key for field in asset_type.fields):
        raise DomainError(f"Il campo «{field_key}» esiste già per questa sottoclasse di asset.")
    field = MaintenanceAssetField(
        asset_type_id=asset_type.id,
        field_key=field_key,
        label=label,
        field_type=field_type,
        is_required=is_required,
        is_searchable=is_searchable,
        options=options,
        sort_order=sort_order,
    )
    db.add(field)
    db.flush()
    return field


def create_class_field(
    db: Session,
    asset_class: MaintenanceAssetClass,
    *,
    field_key: str,
    label: str,
    field_type,
    is_required: bool,
    is_searchable: bool,
    options: list[str],
    sort_order: int,
) -> MaintenanceAssetField:
    """Crea un attributo generico a livello di classe, condiviso da tutte le
    sottoclassi (es. sito, produttore, modello, numero di serie)."""
    if any(field.field_key == field_key for field in asset_class.fields):
        raise DomainError(f"Il campo «{field_key}» esiste già per questa classe di asset.")
    field = MaintenanceAssetField(
        asset_class_id=asset_class.id,
        field_key=field_key,
        label=label,
        field_type=field_type,
        is_required=is_required,
        is_searchable=is_searchable,
        options=options,
        sort_order=sort_order,
    )
    db.add(field)
    db.flush()
    return field


def get_asset_field_or_404(db: Session, field_id: str) -> MaintenanceAssetField:
    field = db.get(MaintenanceAssetField, field_id)
    if field is None:
        raise DomainError("Campo non trovato.")
    return field


def update_asset_field(
    db: Session,
    field: MaintenanceAssetField,
    *,
    label: str | None,
    field_type,
    is_required: bool | None,
    is_searchable: bool | None,
    options: list[str] | None,
    sort_order: int | None,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAssetField:
    # La chiave tecnica (field_key) non è modificabile: è quella con cui i
    # valori sono già salvati in MaintenanceAsset.custom_fields, rinominarla
    # renderebbe orfani i valori esistenti senza un percorso di migrazione.
    if label:
        field.label = label
    if field_type is not None:
        field.field_type = field_type
    if is_required is not None:
        field.is_required = is_required
    if is_searchable is not None:
        field.is_searchable = is_searchable
    if options is not None:
        field.options = options
    if sort_order is not None:
        field.sort_order = sort_order
    db.flush()
    record_audit_log(
        db,
        action="update",
        entity="maintenance_asset_field",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": field.id, "field_key": field.field_key},
    )
    return field


def delete_asset_field(db: Session, field: MaintenanceAssetField, *, actor_name: str | None, actor_user_id: str | None) -> None:
    # Nessun vincolo di FK dagli asset: i valori già inseriti restano nel
    # custom_fields JSONB come chiavi non più definite, non si perdono dati.
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset_field",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": field.id, "field_key": field.field_key, "asset_type_id": field.asset_type_id, "asset_class_id": field.asset_class_id},
    )
    db.delete(field)


def _field_defs_for_asset_type(asset_type: MaintenanceAssetType) -> dict[str, MaintenanceAssetField]:
    """Unione degli attributi di classe (generici) e di sottoclasse
    (specifici) applicabili a un asset di questa sottoclasse."""
    field_defs = {field.field_key: field for field in asset_type.asset_class.fields}
    field_defs.update({field.field_key: field for field in asset_type.fields})
    return field_defs


def _validate_custom_fields(db: Session, asset_type: MaintenanceAssetType, custom_fields: dict) -> dict:
    field_defs = _field_defs_for_asset_type(asset_type)
    unknown = set(custom_fields) - set(field_defs)
    if unknown:
        raise DomainError(f"Campi non definiti per questa sottoclasse di asset: {', '.join(sorted(unknown))}.")
    for key, field in field_defs.items():
        # I campi immagine si valorizzano caricando un file dopo la creazione
        # dell'asset (serve l'asset_id per il documento): "obbligatorio" non è
        # applicabile in fase di creazione.
        if field.field_type.value == "image":
            continue
        if field.is_required and not custom_fields.get(key) and custom_fields.get(key) != 0:
            raise DomainError(f"Il campo «{field.label}» è obbligatorio per questa sottoclasse di asset.")
        value = custom_fields.get(key)
        if value is None:
            continue
        if field.field_type.value == "number" and not isinstance(value, (int, float)):
            raise DomainError(f"Il campo «{field.label}» deve essere numerico.")
        if field.field_type.value == "select" and field.options and value not in field.options:
            raise DomainError(f"Valore non ammesso per «{field.label}».")
        if field.field_type.value == "employee" and db.get(Employee, value) is None:
            raise DomainError(f"Dipendente non trovato per il campo «{field.label}».")
    return custom_fields


def _generate_internal_code(db: Session, asset_type: MaintenanceAssetType) -> str:
    class_code = asset_type.asset_class.code
    prefix = "".join(word[0] for word in class_code.split("_") if word).upper()[:4] or "AS"
    existing = db.scalars(
        select(MaintenanceAsset.internal_code)
        .join(MaintenanceAssetType, MaintenanceAsset.asset_type_id == MaintenanceAssetType.id)
        .where(MaintenanceAssetType.asset_class_id == asset_type.asset_class_id)
    ).all()
    next_number = len(existing) + 1
    candidate = f"{prefix}-{next_number:04d}"
    while candidate in existing:
        next_number += 1
        candidate = f"{prefix}-{next_number:04d}"
    return candidate


def create_asset(
    db: Session,
    *,
    asset_type_id: str,
    internal_code: str | None = None,
    custom_fields: dict,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAsset:
    asset_type = get_asset_type_or_404(db, asset_type_id)
    validated_fields = _validate_custom_fields(db, asset_type, custom_fields)

    internal_code = (internal_code or "").strip()
    if internal_code:
        # Codifica propria dell'azienda (§5 del documento requisiti): niente
        # generazione automatica quando l'utente la indica esplicitamente.
        if db.scalar(select(MaintenanceAsset).where(MaintenanceAsset.internal_code == internal_code)) is not None:
            raise DomainError(f"Esiste già un asset con codice interno «{internal_code}».")
    else:
        internal_code = _generate_internal_code(db, asset_type)

    asset = MaintenanceAsset(
        asset_type_id=asset_type.id,
        internal_code=internal_code,
        custom_fields=validated_fields,
    )
    db.add(asset)
    db.flush()

    record_audit_log(
        db,
        action="create",
        entity="maintenance_asset",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset.id, "internal_code": asset.internal_code, "asset_type_id": asset_type.id},
    )
    return asset


def set_image_field(
    db: Session,
    asset: MaintenanceAsset,
    *,
    field_key: str,
    content: bytes,
    original_filename: str,
    mime_type: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAsset:
    """Carica l'allegato di un campo immagine nel dominio anagrafico."""
    asset_type = get_asset_type_or_404(db, asset.asset_type_id)
    field = _field_defs_for_asset_type(asset_type).get(field_key)
    if field is None:
        raise DomainError(f"Campo «{field_key}» non definito per questa sottoclasse di asset.")
    if field.field_type.value != "image":
        raise DomainError(f"Il campo «{field.label}» non è di tipo immagine.")

    maintenance_images.set_image(
        db,
        asset,
        image_kind="technical",
        slot_key=field_key,
        title=field.label,
        content=content,
        original_filename=original_filename,
        mime_type=mime_type,
        actor_name=actor_name,
        actor_user_id=actor_user_id,
    )
    return asset


def remove_image_field(
    db: Session,
    asset: MaintenanceAsset,
    *,
    field_key: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAsset:
    asset_type = get_asset_type_or_404(db, asset.asset_type_id)
    field = _field_defs_for_asset_type(asset_type).get(field_key)
    if field is None or field.field_type.value != "image":
        raise DomainError("Campo immagine non trovato.")
    image = maintenance_images.get_slot_image(db, asset.id, "technical", field_key)
    if image is not None:
        maintenance_images.delete_image(
            db,
            image,
            actor_name=actor_name,
            actor_user_id=actor_user_id,
        )
    return asset


def set_main_image(
    db: Session,
    asset: MaintenanceAsset,
    *,
    content: bytes,
    original_filename: str,
    mime_type: str,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAsset:
    """Carica o sostituisce la foto principale nel dominio immagini."""
    maintenance_images.set_image(
        db,
        asset,
        image_kind="main",
        slot_key="main",
        title="Foto principale",
        content=content,
        original_filename=original_filename,
        mime_type=mime_type,
        actor_name=actor_name,
        actor_user_id=actor_user_id,
    )
    return asset


def remove_main_image(
    db: Session,
    asset: MaintenanceAsset,
    *,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAsset:
    image = maintenance_images.get_slot_image(db, asset.id, "main", "main")
    if image is not None:
        maintenance_images.delete_image(
            db,
            image,
            actor_name=actor_name,
            actor_user_id=actor_user_id,
        )
    return asset


# Chiavi di custom_fields il cui cambiamento va registrato in
# MaintenanceAssetHistory (§5/§13 del documento requisiti: sede, reparto,
# responsabile non si sovrascrivono, si registrano). Sono le stesse tre
# tracciate quando erano colonne dedicate, ora attributi generici di classe.
_TRACKED_CUSTOM_FIELD_KEYS = ("site", "department", "responsible_employee_id")


def update_asset(
    db: Session,
    asset: MaintenanceAsset,
    *,
    changes: dict,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAsset:
    reason = changes.get("change_reason")

    if "status" in changes and changes["status"] is not None:
        new_status = changes["status"]
        new_status_value = new_status.value if hasattr(new_status, "value") else new_status
        old_status_value = asset.status.value if asset.status else None
        if old_status_value != new_status_value:
            db.add(
                MaintenanceAssetHistory(
                    asset_id=asset.id,
                    changed_field="status",
                    old_value=old_status_value,
                    new_value=new_status_value,
                    reason=reason,
                    changed_by=actor_name,
                )
            )
        asset.status = new_status

    if "status_reason" in changes:
        asset.status_reason = (changes["status_reason"] or "").strip() or None

    if "custom_fields" in changes and changes["custom_fields"] is not None:
        asset_type = get_asset_type_or_404(db, asset.asset_type_id)
        old_values = {key: asset.custom_fields.get(key) for key in _TRACKED_CUSTOM_FIELD_KEYS}
        validated_fields = _validate_custom_fields(db, asset_type, changes["custom_fields"])
        for key in _TRACKED_CUSTOM_FIELD_KEYS:
            new_value = validated_fields.get(key)
            if old_values[key] == new_value:
                continue
            db.add(
                MaintenanceAssetHistory(
                    asset_id=asset.id,
                    changed_field=key,
                    old_value=str(old_values[key]) if old_values[key] is not None else None,
                    new_value=str(new_value) if new_value is not None else None,
                    reason=reason,
                    changed_by=actor_name,
                )
            )
        asset.custom_fields = validated_fields

    def _json_safe(value):
        return value.value if hasattr(value, "value") else value

    record_audit_log(
        db,
        action="update",
        entity="maintenance_asset",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset.id, **{k: _json_safe(v) for k, v in changes.items() if k != "custom_fields"}},
    )
    return asset


def list_assets(
    db: Session,
    *,
    asset_type_id: str | None = None,
    asset_class_id: str | None = None,
    search: str | None = None,
    status_filter: str | None = None,
) -> list[MaintenanceAsset]:
    statement = select(MaintenanceAsset).options(
        selectinload(MaintenanceAsset.asset_type).selectinload(MaintenanceAssetType.fields),
        selectinload(MaintenanceAsset.asset_type)
        .selectinload(MaintenanceAssetType.asset_class)
        .selectinload(MaintenanceAssetClass.fields),
    )
    if asset_type_id:
        statement = statement.where(MaintenanceAsset.asset_type_id == asset_type_id)
    if asset_class_id:
        statement = statement.join(
            MaintenanceAssetType, MaintenanceAsset.asset_type_id == MaintenanceAssetType.id
        ).where(MaintenanceAssetType.asset_class_id == asset_class_id)
    if status_filter:
        statement = statement.where(MaintenanceAsset.status == status_filter)
    assets = list(db.scalars(statement).all())

    if search:
        needle = search.strip().lower()
        if needle:
            def matches(asset: MaintenanceAsset) -> bool:
                haystack = " ".join(
                    str(value)
                    for value in [
                        asset.internal_code,
                        *asset.custom_fields.values(),
                    ]
                    if value is not None
                ).lower()
                return needle in haystack

            assets = [asset for asset in assets if matches(asset)]

    return assets


def resolve_employee_field_names(db: Session, assets: list[MaintenanceAsset]) -> dict[str, dict[str, str]]:
    """Nome visualizzato dei campi custom di tipo "employee" (es.
    responsabile) per ciascun asset, risolto in un'unica query bulk — non a
    ogni asset, per non ripetere l'errore N+1 già pagato altrove nel
    progetto (vedi docs/REPORT_OTTIMIZZAZIONI.md §1.1)."""
    employee_field_keys_by_asset: dict[str, set[str]] = {}
    employee_ids: set[str] = set()
    for asset in assets:
        keys = {
            field.field_key
            for field in _field_defs_for_asset_type(asset.asset_type).values()
            if field.field_type.value == "employee"
        }
        employee_field_keys_by_asset[asset.id] = keys
        for key in keys:
            value = asset.custom_fields.get(key)
            if value:
                employee_ids.add(value)

    if not employee_ids:
        return {asset.id: {} for asset in assets}

    names_by_id = {
        employee.id: employee.full_name
        for employee in db.scalars(select(Employee).where(Employee.id.in_(employee_ids))).all()
    }
    return {
        asset.id: {
            key: names_by_id[asset.custom_fields[key]]
            for key in employee_field_keys_by_asset[asset.id]
            if asset.custom_fields.get(key) in names_by_id
        }
        for asset in assets
    }


def public_field_values(db: Session, asset: MaintenanceAsset) -> list[dict]:
    """Valori di custom_fields già pronti per la pagina pubblica del QR
    (manutenzioni.md §18): un valore per campo definito, con label e tipo,
    e per i campi "employee" il nome risolto al posto dell'id. I campi di
    tipo "image" sono esclusi: compaiono come foto, non come testo."""
    field_defs = _field_defs_for_asset_type(asset.asset_type)
    names = resolve_employee_field_names(db, [asset]).get(asset.id, {})
    values: list[dict] = []
    for field in sorted(field_defs.values(), key=lambda f: (f.sort_order, f.label)):
        if field.field_type.value == "image":
            continue
        raw = asset.custom_fields.get(field.field_key)
        if field.field_type.value == "employee":
            value = names.get(field.field_key)
        elif raw is None:
            value = None
        else:
            value = str(raw)
        values.append(
            {
                "field_key": field.field_key,
                "label": field.label,
                "field_type": field.field_type.value,
                "value": value,
            }
        )
    return values


def last_modified_by_assets(db: Session, asset_ids: list[str]) -> dict[str, str | None]:
    """Autore dell'ultima creazione/modifica di ciascun asset, dall'audit log
    (non c'è una colonna dedicata su MaintenanceAsset: aggiungerla sarebbe una
    migrazione per un dato già tracciato altrove). Una query unica per tutti
    gli id richiesti, non una per asset."""
    if not asset_ids:
        return {}
    rows = db.scalars(
        select(AuditLog)
        .where(
            AuditLog.entity == "maintenance_asset",
            AuditLog.action.in_(("create", "update")),
            AuditLog.detail["id"].as_string().in_(asset_ids),
        )
        .order_by(AuditLog.created_at.desc())
    ).all()
    result: dict[str, str | None] = {asset_id: None for asset_id in asset_ids}
    remaining = set(asset_ids)
    for row in rows:
        row_asset_id = row.detail.get("id")
        if row_asset_id in remaining:
            result[row_asset_id] = row.actor_name
            remaining.discard(row_asset_id)
            if not remaining:
                break
    return result


def get_asset_or_404(db: Session, asset_id: str) -> MaintenanceAsset:
    asset = db.get(
        MaintenanceAsset,
        asset_id,
        options=[
            selectinload(MaintenanceAsset.asset_type).selectinload(MaintenanceAssetType.fields),
            selectinload(MaintenanceAsset.asset_type)
            .selectinload(MaintenanceAssetType.asset_class)
            .selectinload(MaintenanceAssetClass.fields),
        ],
    )
    if asset is None:
        raise DomainError("Asset non trovato.")
    return asset


def regenerate_qr_token(
    db: Session, asset: MaintenanceAsset, *, actor_name: str | None, actor_user_id: str | None
) -> MaintenanceAsset:
    """Genera un nuovo token QR per l'asset, invalidando quello precedente
    (semplicemente sovrascritto: non c'è storicizzazione dei token usati, chi
    scansiona la vecchia etichetta stampata da quel momento riceve 404)."""
    asset.qr_token = secrets.token_urlsafe(32)
    record_audit_log(
        db,
        action="regenerate_qr",
        entity="maintenance_asset",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset.id, "internal_code": asset.internal_code},
    )
    return asset


def get_asset_by_qr_token_or_404(db: Session, token: str) -> MaintenanceAsset:
    asset = db.scalar(
        select(MaintenanceAsset)
        .where(MaintenanceAsset.qr_token == token)
        .options(
            selectinload(MaintenanceAsset.asset_type).selectinload(MaintenanceAssetType.asset_class).selectinload(MaintenanceAssetClass.fields),
            selectinload(MaintenanceAsset.asset_type).selectinload(MaintenanceAssetType.fields),
        )
    )
    if asset is None:
        raise DomainError("QR code non valido o non più attivo.")
    return asset


def delete_asset(db: Session, asset: MaintenanceAsset, *, actor_name: str | None, actor_user_id: str | None) -> None:
    """Elimina l'asset e tutto ciò che gli è agganciato: storico, contatori,
    scadenze (con i relativi ack) e documenti — compreso il file fisico su
    SMB, cancellato caso per caso senza bloccare l'intera operazione se la
    condivisione non è raggiungibile (si registra solo un avviso nei log)."""
    asset_id = asset.id

    # Deve essere azzerato prima di cancellare i documenti: la FK
    # main_image_document_id punta a un MaintenanceDocument che stiamo per
    # eliminare, e Postgres verifica i vincoli statement per statement.
    asset.main_image_document_id = None
    db.flush()

    maintenance_images.delete_images_for_asset(db, asset_id)

    documents = list(db.scalars(select(MaintenanceDocument).where(MaintenanceDocument.asset_id == asset_id)))
    for document in documents:
        try:
            smb_storage.delete_document(document.file_path)
        except DomainError:
            logger.warning("File fisico non eliminato per il documento %s (asset %s), rimane orfano sulla condivisione.", document.id, asset_id)
        db.delete(document)

    deadline_ids = list(db.scalars(select(MaintenanceDeadline.id).where(MaintenanceDeadline.asset_id == asset_id)))
    if deadline_ids:
        db.query(MaintenanceDeadlineAck).filter(MaintenanceDeadlineAck.deadline_id.in_(deadline_ids)).delete(synchronize_session=False)
        db.query(MaintenanceDeadline).filter(MaintenanceDeadline.id.in_(deadline_ids)).delete(synchronize_session=False)

    db.query(MaintenanceAssetCounter).filter(MaintenanceAssetCounter.asset_id == asset_id).delete(synchronize_session=False)
    db.query(MaintenanceAssetHistory).filter(MaintenanceAssetHistory.asset_id == asset_id).delete(synchronize_session=False)
    db.query(MaintenanceAssetComment).filter(MaintenanceAssetComment.asset_id == asset_id).delete(synchronize_session=False)

    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": asset_id, "internal_code": asset.internal_code},
    )
    db.delete(asset)


def list_asset_history(db: Session, asset_id: str) -> list[MaintenanceAssetHistory]:
    statement = (
        select(MaintenanceAssetHistory)
        .where(MaintenanceAssetHistory.asset_id == asset_id)
        .order_by(MaintenanceAssetHistory.changed_at.desc())
    )
    return list(db.scalars(statement).all())


def add_asset_comment(db: Session, asset: MaintenanceAsset, *, text: str, actor_name: str | None) -> MaintenanceAssetComment:
    comment = MaintenanceAssetComment(
        asset_id=asset.id,
        text=text.strip(),
        status=asset.status,
        status_reason=asset.status_reason,
        created_by=actor_name,
    )
    db.add(comment)
    db.flush()
    return comment


def list_asset_comments(db: Session, asset_id: str) -> list[MaintenanceAssetComment]:
    statement = (
        select(MaintenanceAssetComment)
        .where(MaintenanceAssetComment.asset_id == asset_id)
        .order_by(MaintenanceAssetComment.created_at.desc())
    )
    return list(db.scalars(statement).all())


def add_counter_reading(
    db: Session,
    asset: MaintenanceAsset,
    *,
    reading_date,
    value,
    unit: str,
    actor_name: str | None,
) -> MaintenanceAssetCounter:
    reading = MaintenanceAssetCounter(
        asset_id=asset.id,
        reading_date=reading_date,
        value=value,
        unit=unit.strip(),
        recorded_by=actor_name,
    )
    db.add(reading)
    db.flush()
    return reading


def list_counter_readings(db: Session, asset_id: str) -> list[MaintenanceAssetCounter]:
    statement = (
        select(MaintenanceAssetCounter)
        .where(MaintenanceAssetCounter.asset_id == asset_id)
        .order_by(MaintenanceAssetCounter.reading_date.desc())
    )
    return list(db.scalars(statement).all())


def list_counter_readings_for_asset_class(db: Session, asset_class_id: str) -> list[MaintenanceAssetCounter]:
    """Letture "ore" di tutti gli asset di una classe, per le statistiche del
    parco (§ dashboard ore in MaintenanceAssetsPage.jsx) — non filtra per
    sottoclasse: il confronto ha senso sull'intera classe (es. tutti i
    carrelli elevatori, frontali e retrattili insieme)."""
    statement = (
        select(MaintenanceAssetCounter)
        .join(MaintenanceAsset, MaintenanceAssetCounter.asset_id == MaintenanceAsset.id)
        .join(MaintenanceAssetType, MaintenanceAsset.asset_type_id == MaintenanceAssetType.id)
        .where(MaintenanceAssetType.asset_class_id == asset_class_id, MaintenanceAssetCounter.unit == "ore")
        .options(selectinload(MaintenanceAssetCounter.asset))
        .order_by(MaintenanceAssetCounter.asset_id, MaintenanceAssetCounter.reading_date.asc())
    )
    return list(db.scalars(statement).all())


def list_all_counter_readings(db: Session) -> list[MaintenanceAssetCounter]:
    statement = (
        select(MaintenanceAssetCounter)
        .options(selectinload(MaintenanceAssetCounter.asset))
        .order_by(MaintenanceAssetCounter.asset_id, MaintenanceAssetCounter.reading_date.desc())
    )
    return list(db.scalars(statement).all())


def get_counter_reading_or_404(db: Session, asset_id: str, counter_id: str) -> MaintenanceAssetCounter:
    reading = db.get(MaintenanceAssetCounter, counter_id)
    if reading is None or reading.asset_id != asset_id:
        raise DomainError("Lettura non trovata.")
    return reading


def update_counter_reading(
    db: Session,
    reading: MaintenanceAssetCounter,
    *,
    reading_date,
    value,
    actor_name: str | None,
    actor_user_id: str | None,
) -> MaintenanceAssetCounter:
    reading.reading_date = reading_date
    reading.value = value
    db.flush()
    record_audit_log(
        db,
        action="update",
        entity="maintenance_asset_counter",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": reading.id, "asset_id": reading.asset_id, "reading_date": str(reading_date), "value": float(value)},
    )
    return reading


def delete_counter_reading(
    db: Session,
    reading: MaintenanceAssetCounter,
    *,
    actor_name: str | None,
    actor_user_id: str | None,
) -> None:
    record_audit_log(
        db,
        action="delete",
        entity="maintenance_asset_counter",
        actor_name=actor_name,
        user_id=actor_user_id,
        detail={"id": reading.id, "asset_id": reading.asset_id, "reading_date": str(reading.reading_date), "value": float(reading.value)},
    )
    db.delete(reading)

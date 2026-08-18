"""Identità di conflitto dei timer paralleli (active_activities).

Due timer dello stesso dipendente sullo stesso incrocio (mapping_id) possono
convivere se almeno un campo obbligatorio del mapping ha un valore diverso
(es. "numero lista" nel Ricevimento Merce). L'identità di conflitto è la
conflict_key: hash dei valori normalizzati dei soli campi obbligatori,
calcolata dal server alla partenza e immutabile per tutta la vita del timer.
"""

from hashlib import sha256

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import FieldDefinition, InfinityMapFieldAssignment


def required_fields(db: Session, mapping_id: str) -> dict[str, str]:
    """Campi obbligatori configurati sull'incrocio: {field_key: field_label}."""
    rows = db.execute(
        select(FieldDefinition.field_key, FieldDefinition.field_label)
        .join(
            InfinityMapFieldAssignment,
            InfinityMapFieldAssignment.field_definition_id == FieldDefinition.id,
        )
        .where(
            InfinityMapFieldAssignment.map_id == mapping_id,
            InfinityMapFieldAssignment.is_required.is_(True),
            FieldDefinition.is_active.is_(True),
        )
    ).all()
    return {key: label for key, label in rows}


def normalize_field_value(value) -> str:
    """Trim + case-insensitive: "123 " e "123" identificano lo stesso timer."""
    return str(value).strip().casefold() if value is not None else ""


def missing_required_fields(required: dict[str, str], field_values: dict | None) -> list[str]:
    """Label dei campi obbligatori senza valore (assenti o vuoti dopo il trim)."""
    values = field_values or {}
    return [label for key, label in sorted(required.items()) if not normalize_field_value(values.get(key))]


def compute_conflict_key(required_keys, field_values: dict | None) -> str:
    """Hash deterministico dei valori normalizzati dei campi obbligatori.

    Stringa vuota se l'incrocio non ha campi obbligatori: il conflitto resta
    sul solo (employee_id, mapping_id) come nel comportamento precedente.
    """
    if not required_keys:
        return ""
    values = field_values or {}
    canonical = "\n".join(
        f"{key}={normalize_field_value(values.get(key))}" for key in sorted(required_keys)
    )
    return sha256(canonical.encode("utf-8")).hexdigest()

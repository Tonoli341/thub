from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import (
    Employee,
    FieldDefinition,
    InfinityBillingCustomerSupplierMap,
    InfinityMapFieldAssignment,
    User,
)
from app.schemas import (
    CONFIG_FIELD_TYPES,
    FIELD_TYPES,
    FieldDefinitionCreate,
    FieldDefinitionRead,
    FieldDefinitionUpdate,
    ValueListConfig,
    ValueListSourceColumnsRead,
    ValueListSourceRead,
    ValueListValuesRead,
)
from app.api.deps import get_current_local_employee, require_organization_access
from app.services.audit import record_audit_log
from app.services.security import get_current_user
from app.services.value_list_sources import VALUE_LIST_SOURCES, ValueListSource, get_source
from app.services.value_lists import fetch_value_list, fetch_value_list_columns

router = APIRouter(prefix="/field-definitions", tags=["field-definitions"])

# La app di rendicontazione si autentica come Employee (get_current_local_employee),
# non come User: i suoi endpoint non possono stare sul router admin, che è montato
# sotto protected_router (get_current_user). Vedi api/__init__.py.
operator_router = APIRouter(prefix="/field-definitions", tags=["field-definitions"])


def _get_field_def_or_404(db: Session, field_def_id: str) -> FieldDefinition:
    obj = db.get(FieldDefinition, field_def_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campo non trovato.")
    return obj


def _get_source_or_404(source_key: str) -> ValueListSource:
    source = get_source(source_key)
    if source is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Sorgente '{source_key}' non trovata.",
        )
    return source


def _validate_field_type(field_type: str) -> None:
    if field_type not in FIELD_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"field_type deve essere uno di: {', '.join(sorted(FIELD_TYPES))}",
        )


def _validate_config(field_type: str, config: ValueListConfig | None) -> None:
    """Coerenza fra tipo e config.

    La validazione è *auto-consistente* (source nel registro, key_column fra le
    colonne dichiarate) e non interroga MSSQL: le colonne arrivano dalla UI, che
    le ha già lette da /value-list-sources/{source}/columns. Così un MSSQL
    irraggiungibile non blocca il salvataggio della configurazione.
    """
    if field_type not in CONFIG_FIELD_TYPES:
        if config is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"config è ammesso solo per i tipi: {', '.join(sorted(CONFIG_FIELD_TYPES))}",
            )
        return

    if config is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"config è obbligatorio per field_type='{field_type}'.",
        )
    if config.source not in VALUE_LIST_SOURCES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"config.source deve essere uno di: {', '.join(sorted(VALUE_LIST_SOURCES))}",
        )
    if not config.columns:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="config.columns non può essere vuoto.",
        )
    names = [col.name for col in config.columns]
    if len(names) != len(set(names)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="config.columns contiene nomi duplicati.",
        )
    if config.key_column not in names:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"config.key_column '{config.key_column}' non è fra le colonne dichiarate.",
        )


def _resolve_source_params(
    source: ValueListSource,
    db: Session,
    field_def_id: str,
    mapping_id: str | None,
) -> dict[str, str]:
    """Risolve i parametri della sorgente dall'incrocio, server-side.

    Il client passa solo il mapping_id: il codice società non transita mai dalla
    rete, e non può essere scelto liberamente da chi chiama.
    """
    if not source.params:
        return {}

    if not mapping_id:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"mapping_id è obbligatorio per la sorgente '{source.key}'.",
        )

    map_obj = db.get(InfinityBillingCustomerSupplierMap, mapping_id)
    if map_obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incrocio non trovato.")

    # Il campo dev'essere davvero assegnato a questo incrocio: impedisce di
    # interrogare combinazioni campo/incrocio mai configurate.
    assigned = db.scalar(
        select(InfinityMapFieldAssignment.id).where(
            InfinityMapFieldAssignment.map_id == mapping_id,
            InfinityMapFieldAssignment.field_definition_id == field_def_id,
        )
    )
    if assigned is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Il campo non è assegnato a questo incrocio.",
        )

    available = {"customer_supplier_code": map_obj.customer_supplier_code}
    missing = [name for name in source.params if not available.get(name)]
    if missing:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Parametri non risolvibili dall'incrocio: {', '.join(missing)}.",
        )
    return {name: available[name] for name in source.params}


def _load_values(db: Session, field_def_id: str, mapping_id: str | None) -> ValueListValuesRead:
    obj = _get_field_def_or_404(db, field_def_id)
    if obj.field_type not in CONFIG_FIELD_TYPES or not obj.config:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Il campo '{obj.field_key}' non è una value-list.",
        )

    config = ValueListConfig.model_validate(obj.config)
    source = _get_source_or_404(config.source)
    params = _resolve_source_params(source, db, field_def_id, mapping_id)

    try:
        rows = fetch_value_list(source, params)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc

    return ValueListValuesRead(
        source=config.source,
        key_column=config.key_column,
        columns=config.columns,
        rows=rows,
    )


# ── Sorgenti (config-time, admin) ─────────────────────────────────────────────
# Dichiarate prima di /{field_def_id}, altrimenti FastAPI risolverebbe
# "value-list-sources" come un id.


@router.get("/value-list-sources", response_model=list[ValueListSourceRead])
def list_value_list_sources(
    _: User = Depends(get_current_user),
) -> list[ValueListSourceRead]:
    return [
        ValueListSourceRead(key=src.key, label=src.label, params=list(src.params))
        for src in sorted(VALUE_LIST_SOURCES.values(), key=lambda s: s.label)
    ]


@router.get("/value-list-sources/{source_key}/columns", response_model=ValueListSourceColumnsRead)
def list_value_list_source_columns(
    source_key: str,
    _: User = Depends(require_organization_access),
) -> ValueListSourceColumnsRead:
    source = _get_source_or_404(source_key)
    try:
        columns = fetch_value_list_columns(source)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=str(exc)) from exc
    return ValueListSourceColumnsRead(source=source.key, columns=columns)


# ── CRUD libreria campi ───────────────────────────────────────────────────────


@router.get("", response_model=list[FieldDefinitionRead])
def list_field_definitions(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[FieldDefinitionRead]:
    rows = db.scalars(
        select(FieldDefinition).order_by(FieldDefinition.field_label.asc())
    ).all()
    return [FieldDefinitionRead.model_validate(r) for r in rows]


@router.post("", response_model=FieldDefinitionRead, status_code=status.HTTP_201_CREATED)
def create_field_definition(
    payload: FieldDefinitionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> FieldDefinitionRead:
    _validate_field_type(payload.field_type)
    _validate_config(payload.field_type, payload.config)
    existing = db.scalar(
        select(FieldDefinition).where(FieldDefinition.field_key == payload.field_key)
    )
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Esiste già un campo con field_key='{payload.field_key}'.",
        )
    obj = FieldDefinition(**payload.model_dump())
    db.add(obj)
    record_audit_log(db, action="create", entity="field_definition", actor_name=current_user.username, user_id=current_user.id, detail=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(obj)
    return FieldDefinitionRead.model_validate(obj)


@router.get("/{field_def_id}", response_model=FieldDefinitionRead)
def get_field_definition(
    field_def_id: str,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> FieldDefinitionRead:
    return FieldDefinitionRead.model_validate(_get_field_def_or_404(db, field_def_id))


@router.patch("/{field_def_id}", response_model=FieldDefinitionRead)
def update_field_definition(
    field_def_id: str,
    payload: FieldDefinitionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> FieldDefinitionRead:
    obj = _get_field_def_or_404(db, field_def_id)
    data = payload.model_dump(exclude_unset=True)
    if "field_type" in data:
        _validate_field_type(data["field_type"])
    # Tipo e config vanno validati insieme anche quando la PATCH ne tocca uno
    # solo: il valore non toccato resta quello già a DB. Uscendo da una
    # value-list la config residua non va rivalidata (verrebbe rifiutata dal
    # nuovo tipo): la trattiamo come assente, tanto sotto viene azzerata.
    field_type = data.get("field_type", obj.field_type)
    if field_type not in CONFIG_FIELD_TYPES:
        config = None
    elif "config" in data:
        config = payload.config
    else:
        config = ValueListConfig.model_validate(obj.config) if obj.config else None
    _validate_config(field_type, config)
    if "field_key" in data and data["field_key"] != obj.field_key:
        existing = db.scalar(
            select(FieldDefinition).where(FieldDefinition.field_key == data["field_key"])
        )
        if existing:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Esiste già un campo con field_key='{data['field_key']}'.",
            )
    for k, v in data.items():
        setattr(obj, k, v)
    # Cambiando tipo verso/da una value-list, la config dell'altro tipo va
    # ripulita: _validate_config la impone assente fuori da CONFIG_FIELD_TYPES.
    if field_type not in CONFIG_FIELD_TYPES:
        obj.config = None
    record_audit_log(db, action="update", entity="field_definition", actor_name=current_user.username, user_id=current_user.id, detail={"id": field_def_id, **payload.model_dump(mode="json", exclude_unset=True)})
    db.commit()
    db.refresh(obj)
    return FieldDefinitionRead.model_validate(obj)


@router.delete("/{field_def_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_field_definition(
    field_def_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_organization_access),
) -> None:
    obj = _get_field_def_or_404(db, field_def_id)
    record_audit_log(db, action="delete", entity="field_definition", actor_name=current_user.username, user_id=current_user.id, detail={"id": field_def_id, "field_key": obj.field_key})
    db.delete(obj)
    db.commit()


# ── Valori (runtime, app di rendicontazione) ──────────────────────────────────


@operator_router.get("/{field_def_id}/values", response_model=ValueListValuesRead)
def get_operator_field_values(
    field_def_id: str,
    mapping_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _employee: Employee = Depends(get_current_local_employee),
) -> ValueListValuesRead:
    return _load_values(db, field_def_id, mapping_id)

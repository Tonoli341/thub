from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import Select, cast, func, select
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_organization_access
from app.db import get_db
from app.models import FieldDefinition, InfinityBillingCustomerSupplierMap, InfinityBillingItem, InfinityMapFieldAssignment, OperationalArea, User
from app.operational_reporting_models import OperationalReportAllocation
from app.schemas import (
    InfinityBillingCustomerSupplierMapCreate,
    InfinityBillingCustomerSupplierMapRead,
    InfinityBillingCustomerSupplierMapUpdate,
    InfinityMapFieldAssignmentRead,
    InfinityMapFieldAssignmentsBulkReplace,
)
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(
    prefix="/infinity-billing-customer-supplier-map",
    tags=["infinity-billing-customer-supplier-map"],
    dependencies=[Depends(require_organization_access)],
)


def _list_statement() -> Select[tuple[InfinityBillingCustomerSupplierMap]]:
    return (
        select(InfinityBillingCustomerSupplierMap)
        .options(
            selectinload(InfinityBillingCustomerSupplierMap.infinity_billing_item),
            selectinload(InfinityBillingCustomerSupplierMap.operational_area),
            selectinload(InfinityBillingCustomerSupplierMap.field_assignments).selectinload(
                InfinityMapFieldAssignment.field_definition
            ),
        )
        .order_by(
            InfinityBillingCustomerSupplierMap.customer_supplier_description.asc(),
            InfinityBillingCustomerSupplierMap.customer_supplier_code.asc(),
        )
    )


def _get_map(db: Session, item_id: str) -> InfinityBillingCustomerSupplierMap | None:
    return db.scalar(_list_statement().where(InfinityBillingCustomerSupplierMap.id == item_id))


def _ensure_infinity_item_exists(db: Session, infinity_billing_item_id: str) -> None:
    item = db.get(InfinityBillingItem, infinity_billing_item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Voce Infinity non valida.")


def _validate_operational_area_payload(
    db: Session,
    operational_area_id: str | None,
    buildings: list[str] | None,
) -> None:
    if not operational_area_id:
        if buildings:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Seleziona prima un'area operativa.")
        return

    area = db.get(OperationalArea, operational_area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Area operativa non valida.")

    valid_buildings = {str(item).strip() for item in (area.buildings or []) if str(item).strip()}
    invalid = [item for item in (buildings or []) if item not in valid_buildings]
    if invalid:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Uno o piu immobili non appartengono all'area selezionata.")


def _ensure_unique_pair(
    db: Session,
    infinity_billing_item_id: str,
    customer_supplier_code: str,
    jupiter_description: str | None,
    current_id: str | None = None,
) -> None:
    statement = select(InfinityBillingCustomerSupplierMap).where(
        InfinityBillingCustomerSupplierMap.infinity_billing_item_id == infinity_billing_item_id,
        func.lower(InfinityBillingCustomerSupplierMap.customer_supplier_code) == customer_supplier_code.lower(),
        func.lower(func.coalesce(InfinityBillingCustomerSupplierMap.jupiter_description, "")) == (jupiter_description or "").lower(),
    )
    if current_id is not None:
        statement = statement.where(InfinityBillingCustomerSupplierMap.id != current_id)
    duplicate = db.scalar(statement)
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Incrocio Infinity / Cliente-Fornitore gia esistente.")


@router.get("", response_model=list[InfinityBillingCustomerSupplierMapRead])
def list_infinity_billing_customer_supplier_map(
    db: Session = Depends(get_db),
) -> list[InfinityBillingCustomerSupplierMap]:
    return list(db.scalars(_list_statement()).all())


@router.post("", response_model=InfinityBillingCustomerSupplierMapRead, status_code=status.HTTP_201_CREATED)
def create_infinity_billing_customer_supplier_map(
    payload: InfinityBillingCustomerSupplierMapCreate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InfinityBillingCustomerSupplierMap:
    _ensure_infinity_item_exists(db, payload.infinity_billing_item_id)
    _ensure_unique_pair(db, payload.infinity_billing_item_id, payload.customer_supplier_code, payload.jupiter_description)
    _validate_operational_area_payload(db, payload.operational_area_id, payload.buildings)

    obj = InfinityBillingCustomerSupplierMap(**payload.model_dump())
    db.add(obj)
    record_audit_log(
        db,
        action="create",
        entity="infinity_billing_customer_supplier_map",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=payload.model_dump(),
    )
    db.commit()
    return _get_map(db, obj.id)


@router.put("/{map_id}", response_model=InfinityBillingCustomerSupplierMapRead)
def update_infinity_billing_customer_supplier_map(
    map_id: str,
    payload: InfinityBillingCustomerSupplierMapUpdate,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> InfinityBillingCustomerSupplierMap:
    obj = db.get(InfinityBillingCustomerSupplierMap, map_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incrocio Infinity / Cliente-Fornitore non trovato.")

    values = payload.model_dump(exclude_unset=True)
    next_infinity_item_id = values.get("infinity_billing_item_id", obj.infinity_billing_item_id)
    next_customer_supplier_code = values.get("customer_supplier_code", obj.customer_supplier_code)
    next_jupiter_description = values.get("jupiter_description", obj.jupiter_description)
    next_operational_area_id = values.get("operational_area_id", obj.operational_area_id)
    next_buildings = values.get("buildings", obj.buildings)
    if "infinity_billing_item_id" in values:
        _ensure_infinity_item_exists(db, next_infinity_item_id)
    if "infinity_billing_item_id" in values or "customer_supplier_code" in values or "jupiter_description" in values:
        _ensure_unique_pair(db, next_infinity_item_id, next_customer_supplier_code, next_jupiter_description, current_id=map_id)
    if "operational_area_id" in values or "buildings" in values:
        _validate_operational_area_payload(db, next_operational_area_id, next_buildings)

    previous = InfinityBillingCustomerSupplierMapRead.model_validate(_get_map(db, map_id)).model_dump(mode="json")
    for field, value in values.items():
        setattr(obj, field, value)

    propagated_allocations = 0
    snapshot_fields_changed = any(
        field in values
        for field in ("customer_supplier_code", "customer_supplier_description", "jupiter_description")
    )
    if snapshot_fields_changed:
        # ``eligible_mapping_ids`` è volutamente uno snapshot JSON e non una FK:
        # se l'incrocio viene eliminato lo storico deve continuare a funzionare.
        # In modifica, invece, aggiorniamo i valori leggibili dei box che fanno
        # ancora riferimento a questo incrocio.
        allocation_statement = select(OperationalReportAllocation)
        if db.bind is not None and db.bind.dialect.name == "postgresql":
            allocation_statement = allocation_statement.where(
                cast(OperationalReportAllocation.eligible_mapping_ids, JSONB).contains([map_id])
            )
        allocations = db.scalars(allocation_statement).all()
        for allocation in allocations:
            if map_id not in (allocation.eligible_mapping_ids or []):
                continue
            if "customer_supplier_code" in values:
                allocation.customer_code = next_customer_supplier_code
            if "customer_supplier_description" in values:
                allocation.customer_description_snapshot = values["customer_supplier_description"]
            if "jupiter_description" in values:
                allocation.jupiter_description_snapshot = next_jupiter_description
            propagated_allocations += 1

    db.flush()
    current = _get_map(db, map_id)
    record_audit_log(
        db,
        action="update",
        entity="infinity_billing_customer_supplier_map",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "before": previous,
            "after": InfinityBillingCustomerSupplierMapRead.model_validate(current).model_dump(mode="json"),
            "propagated_operational_allocations": propagated_allocations,
        },
    )
    db.commit()
    return _get_map(db, map_id)


@router.delete("/{map_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_infinity_billing_customer_supplier_map(
    map_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> None:
    obj = _get_map(db, map_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incrocio Infinity / Cliente-Fornitore non trovato.")

    record_audit_log(
        db,
        action="delete",
        entity="infinity_billing_customer_supplier_map",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=InfinityBillingCustomerSupplierMapRead.model_validate(obj).model_dump(mode="json"),
    )
    db.delete(obj)
    db.commit()


@router.put("/{map_id}/field-assignments", response_model=list[InfinityMapFieldAssignmentRead])
def replace_field_assignments(
    map_id: str,
    payload: InfinityMapFieldAssignmentsBulkReplace,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[InfinityMapFieldAssignmentRead]:
    obj = db.get(InfinityBillingCustomerSupplierMap, map_id)
    if obj is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Incrocio non trovato.")

    # Validate all field_definition_id exist
    for item in payload.assignments:
        fd = db.get(FieldDefinition, item.field_definition_id)
        if fd is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"FieldDefinition '{item.field_definition_id}' non trovata.",
            )

    # Bulk replace: delete existing, insert new
    existing = db.scalars(
        select(InfinityMapFieldAssignment).where(InfinityMapFieldAssignment.map_id == map_id)
    ).all()
    for a in existing:
        db.delete(a)
    db.flush()

    new_assignments = []
    for item in payload.assignments:
        a = InfinityMapFieldAssignment(
            map_id=map_id,
            field_definition_id=item.field_definition_id,
            is_required=item.is_required,
            sort_order=item.sort_order,
        )
        db.add(a)
        new_assignments.append(a)

    record_audit_log(
        db,
        action="update",
        entity="infinity_map_field_assignments",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "map_id": map_id,
            "assignments": [item.model_dump(mode="json") for item in payload.assignments],
        },
    )
    db.commit()

    # Reload with field_definition eager loaded
    result = db.scalars(
        select(InfinityMapFieldAssignment)
        .where(InfinityMapFieldAssignment.map_id == map_id)
        .options(selectinload(InfinityMapFieldAssignment.field_definition))
        .order_by(InfinityMapFieldAssignment.sort_order.asc())
    ).all()
    return [InfinityMapFieldAssignmentRead.from_orm_with_def(r) for r in result]

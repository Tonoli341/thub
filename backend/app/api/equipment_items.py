from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_deliveries_access, require_deliveries_access_or_tablet
from app.db import get_db
from app.models import EquipmentItem, SizeGroup, SizeOption, User
from app.schemas import EquipmentItemCreate, EquipmentItemRead, EquipmentItemUpdate, SizeGroupRead, SizeOptionRead
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(prefix="/equipment-items", tags=["equipment-items"])


def serialize_equipment_item(item: EquipmentItem) -> EquipmentItemRead:
    size_options = sorted(item.available_size_options, key=lambda option: (option.group.sort_order if option.group else 0, option.sort_order))
    return EquipmentItemRead(
        id=item.id,
        name=item.name,
        category=item.category,
        notes=item.notes,
        is_active=item.is_active,
        available_sizes=[option.value for option in size_options],
        available_size_ids=[option.id for option in size_options],
        created_at=item.created_at,
        updated_at=item.updated_at,
    )


@router.get("/size-groups", response_model=list[SizeGroupRead], dependencies=[Depends(require_deliveries_access)])
def list_size_groups(db: Session = Depends(get_db)) -> list[SizeGroupRead]:
    groups = db.scalars(select(SizeGroup).options(selectinload(SizeGroup.options)).order_by(SizeGroup.sort_order.asc(), SizeGroup.name.asc())).all()
    return [
        SizeGroupRead(
            id=group.id,
            name=group.name,
            sort_order=group.sort_order,
            options=[SizeOptionRead(id=option.id, value=option.value, sort_order=option.sort_order) for option in group.options],
        )
        for group in groups
    ]


@router.get("", response_model=list[EquipmentItemRead])
def list_equipment_items(
    include_inactive: bool = Query(default=False),
    db: Session = Depends(get_db),
    _auth: User | None = Depends(require_deliveries_access_or_tablet),
) -> list[EquipmentItemRead]:
    statement: Select[tuple[EquipmentItem]] = select(EquipmentItem).options(
        selectinload(EquipmentItem.available_size_options).selectinload(SizeOption.group)
    )
    if not include_inactive:
        statement = statement.where(EquipmentItem.is_active.is_(True))
    statement = statement.order_by(EquipmentItem.category.asc(), EquipmentItem.name.asc())
    return [serialize_equipment_item(item) for item in db.scalars(statement).all()]


@router.post("", response_model=EquipmentItemRead, status_code=status.HTTP_201_CREATED, dependencies=[Depends(require_deliveries_access)])
def create_equipment_item(
    payload: EquipmentItemCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EquipmentItemRead:
    duplicate = db.scalar(select(EquipmentItem).where(func.lower(EquipmentItem.name) == payload.name.strip().lower()))
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Articolo gia esistente.")

    item = EquipmentItem(
        name=payload.name.strip(),
        category=payload.category,
        notes=payload.notes.strip() if payload.notes else None,
    )
    if payload.available_size_ids:
        item.available_size_options = list(
            db.scalars(select(SizeOption).where(SizeOption.id.in_(payload.available_size_ids))).all()
        )
    db.add(item)
    record_audit_log(
        db,
        action="create",
        entity="equipment_item",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=payload.model_dump(mode="json"),
    )
    db.commit()
    item = db.scalar(
        select(EquipmentItem)
        .where(EquipmentItem.id == item.id)
        .options(selectinload(EquipmentItem.available_size_options).selectinload(SizeOption.group))
    )
    return serialize_equipment_item(item)


@router.patch("/{item_id}", response_model=EquipmentItemRead, dependencies=[Depends(require_deliveries_access)])
def update_equipment_item(
    item_id: str,
    payload: EquipmentItemUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> EquipmentItemRead:
    item = db.scalar(
        select(EquipmentItem)
        .where(EquipmentItem.id == item_id)
        .options(selectinload(EquipmentItem.available_size_options).selectinload(SizeOption.group))
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Articolo non trovato.")

    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"]:
        normalized = changes["name"].strip()
        duplicate = db.scalar(
            select(EquipmentItem).where(func.lower(EquipmentItem.name) == normalized.lower(), EquipmentItem.id != item_id)
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Articolo gia esistente.")
        item.name = normalized
    if "category" in changes and changes["category"] is not None:
        item.category = changes["category"]
    if "notes" in changes:
        item.notes = changes["notes"].strip() if changes["notes"] else None
    if "is_active" in changes and changes["is_active"] is not None:
        item.is_active = changes["is_active"]
    if "available_size_ids" in changes:
        size_ids = changes["available_size_ids"] or []
        item.available_size_options = list(db.scalars(select(SizeOption).where(SizeOption.id.in_(size_ids))).all()) if size_ids else []

    record_audit_log(
        db,
        action="update",
        entity="equipment_item",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"id": item_id, **changes},
    )
    db.commit()
    item = db.scalar(
        select(EquipmentItem)
        .where(EquipmentItem.id == item.id)
        .options(selectinload(EquipmentItem.available_size_options).selectinload(SizeOption.group))
    )
    return serialize_equipment_item(item)

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, select
from sqlalchemy.orm import Session

from app.api.deps import require_organization_access
from app.db import get_db
from app.models import InfinityBillingItem, User
from app.schemas import InfinityBillingItemCreate, InfinityBillingItemRead, InfinityBillingItemUpdate
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(
    prefix="/infinity-billing-items",
    tags=["infinity-billing-items"],
    dependencies=[Depends(require_organization_access)],
)


@router.get("", response_model=list[InfinityBillingItemRead])
def list_infinity_billing_items(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
) -> list[InfinityBillingItem]:
    statement: Select[tuple[InfinityBillingItem]] = select(InfinityBillingItem)
    if active_only:
        statement = statement.where(InfinityBillingItem.is_active.is_(True))
    statement = statement.order_by(InfinityBillingItem.name.asc())
    return list(db.scalars(statement).all())


@router.post("", response_model=InfinityBillingItemRead, status_code=status.HTTP_201_CREATED)
def create_infinity_billing_item(payload: InfinityBillingItemCreate, current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)) -> InfinityBillingItem:
    duplicate = db.scalar(
        select(InfinityBillingItem).where(
            func.lower(InfinityBillingItem.name) == payload.name.lower(),
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Voce Infinity gia esistente.")

    item = InfinityBillingItem(**payload.model_dump())
    db.add(item)
    record_audit_log(db, action="create", entity="infinity_billing_item", actor_name=current_user.username, user_id=current_user.id, detail=payload.model_dump())
    db.commit()
    db.refresh(item)
    return item


@router.put("/{item_id}", response_model=InfinityBillingItemRead)
def update_infinity_billing_item(item_id: str, payload: InfinityBillingItemUpdate, current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)) -> InfinityBillingItem:
    item = db.get(InfinityBillingItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voce Infinity non trovata.")

    values = payload.model_dump(exclude_unset=True)
    if "name" in values:
        duplicate = db.scalar(
            select(InfinityBillingItem).where(
                func.lower(InfinityBillingItem.name) == values["name"].lower(),
                InfinityBillingItem.id != item_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Voce Infinity gia esistente.")

    previous = InfinityBillingItemRead.model_validate(item).model_dump(mode="json")
    for field, value in values.items():
        setattr(item, field, value)

    record_audit_log(
        db,
        action="update",
        entity="infinity_billing_item",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"before": previous, "after": InfinityBillingItemRead.model_validate(item).model_dump(mode="json")},
    )
    db.commit()
    db.refresh(item)
    return item


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_infinity_billing_item(item_id: str, current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)) -> None:
    item = db.get(InfinityBillingItem, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Voce Infinity non trovata.")

    record_audit_log(
        db,
        action="delete",
        entity="infinity_billing_item",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=InfinityBillingItemRead.model_validate(item).model_dump(mode="json"),
    )
    db.delete(item)
    db.commit()

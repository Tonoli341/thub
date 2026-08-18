from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_organization_access
from app.db import get_db
from app.models import ToolChange, User
from app.schemas import ToolChangeCreate, ToolChangeRead, ToolChangeUpdate
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(prefix="/tool-changes", tags=["tool-changes"], dependencies=[Depends(require_organization_access)])


@router.get("", response_model=list[ToolChangeRead])
def list_tool_changes(db: Session = Depends(get_db)) -> list[ToolChange]:
    return list(db.scalars(select(ToolChange).order_by(ToolChange.sort_order.asc(), ToolChange.created_at.asc())).all())


@router.post("", response_model=ToolChangeRead, status_code=status.HTTP_201_CREATED)
def create_tool_change(
    payload: ToolChangeCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ToolChange:
    max_order = db.scalar(select(ToolChange.sort_order).order_by(ToolChange.sort_order.desc()).limit(1)) or 0
    change = ToolChange(text=payload.text, sort_order=max_order + 1)
    db.add(change)
    record_audit_log(db, action="create", entity="tool_change", actor_name=current_user.username, user_id=current_user.id, detail=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(change)
    return change


@router.patch("/{change_id}", response_model=ToolChangeRead)
def update_tool_change(
    change_id: str,
    payload: ToolChangeUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ToolChange:
    change = db.get(ToolChange, change_id)
    if change is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool change not found.")
    changes = payload.model_dump(exclude_unset=True)
    for field, value in changes.items():
        setattr(change, field, value)
    record_audit_log(db, action="update", entity="tool_change", actor_name=current_user.username, user_id=current_user.id, detail={"id": change_id, **changes})
    db.commit()
    db.refresh(change)
    return change


@router.delete("/{change_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_tool_change(
    change_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> None:
    change = db.get(ToolChange, change_id)
    if change is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Tool change not found.")
    record_audit_log(db, action="delete", entity="tool_change", actor_name=current_user.username, user_id=current_user.id, detail={"id": change_id, "text": change.text})
    db.delete(change)
    db.commit()

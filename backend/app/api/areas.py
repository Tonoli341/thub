from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_organization_access
from app.db import get_db
from app.models import Employee, OperationalArea, TimesheetMapping, User
from app.schemas import OperationalAreaCreate, OperationalAreaRead, OperationalAreaUpdate
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(prefix="/operational-areas", tags=["operational-areas"])


@router.get("", response_model=list[OperationalAreaRead])
def list_operational_areas(
    active_only: bool = Query(default=False),
    operational_only: bool = Query(default=False),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[OperationalArea]:
    statement: Select[tuple[OperationalArea]] = select(OperationalArea)
    if active_only:
        statement = statement.where(OperationalArea.is_active.is_(True))
    if operational_only:
        statement = statement.where(OperationalArea.is_operational.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                OperationalArea.area_code.ilike(pattern),
                OperationalArea.name.ilike(pattern),
                OperationalArea.description.ilike(pattern),
            )
        )
    statement = statement.order_by(OperationalArea.name.asc())
    rows = list(db.scalars(statement).all())
    for row in rows:
        if row.buildings is None:
            row.buildings = []
    return rows


@router.post("", response_model=OperationalAreaRead, status_code=status.HTTP_201_CREATED)
def create_operational_area(payload: OperationalAreaCreate, current_user: User = Depends(require_organization_access),
    db: Session = Depends(get_db)) -> OperationalArea:
    duplicate = db.scalar(
        select(OperationalArea).where(
            or_(
                func.lower(OperationalArea.area_code) == payload.area_code.lower(),
                func.lower(OperationalArea.name) == payload.name.lower(),
            )
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Operational area code or name already exists.")

    area = OperationalArea(**payload.model_dump())
    db.add(area)
    record_audit_log(db, action="create", entity="operational_area", actor_name=current_user.username, user_id=current_user.id, detail=payload.model_dump())
    db.commit()
    db.refresh(area)
    return area


@router.put("/{area_id}", response_model=OperationalAreaRead)
def update_operational_area(area_id: str, payload: OperationalAreaUpdate, current_user: User = Depends(require_organization_access),
    db: Session = Depends(get_db)) -> OperationalArea:
    area = db.get(OperationalArea, area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operational area not found.")
    if area.buildings is None:
        area.buildings = []

    values = payload.model_dump(exclude_unset=True)
    if "area_code" in values:
        duplicate = db.scalar(
            select(OperationalArea).where(
                func.lower(OperationalArea.area_code) == values["area_code"].lower(),
                OperationalArea.id != area_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Operational area code already exists.")
    if "name" in values:
        duplicate = db.scalar(
            select(OperationalArea).where(
                func.lower(OperationalArea.name) == values["name"].lower(),
                OperationalArea.id != area_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Operational area name already exists.")

    previous = OperationalAreaRead.model_validate(area).model_dump(mode="json")
    for field, value in values.items():
        setattr(area, field, value)

    record_audit_log(
        db,
        action="update",
        entity="operational_area",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"before": previous, "after": OperationalAreaRead.model_validate(area).model_dump(mode="json")},
    )
    db.commit()
    db.refresh(area)
    return area


@router.delete("/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_operational_area(area_id: str, current_user: User = Depends(require_organization_access),
    db: Session = Depends(get_db)) -> None:
    area = db.get(OperationalArea, area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operational area not found.")
    if area.buildings is None:
        area.buildings = []

    linked_employee = db.scalar(select(Employee).where(Employee.default_operational_area_id == area_id).limit(1))
    if linked_employee is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Area operativa assegnata a uno o piu dipendenti. Rimuovi prima i collegamenti.",
        )

    linked_cost_center_mapping = db.scalar(
        select(TimesheetMapping).where(
            TimesheetMapping.mapping_type == "cost_center",
            TimesheetMapping.internal_key == area.area_code,
        ).limit(1)
    )
    if linked_cost_center_mapping is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Area operativa usata nei mapping centri di costo. Rimuovi prima i mapping collegati.",
        )

    record_audit_log(
        db,
        action="delete",
        entity="operational_area",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=OperationalAreaRead.model_validate(area).model_dump(mode="json"),
    )
    db.delete(area)
    db.commit()

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import Select, func, or_, select
from sqlalchemy.orm import Session

from app.api.deps import require_organization_access
from app.db import get_db
from app.models import LocalProject, TimesheetMapping, User
from app.schemas import LocalProjectCreate, LocalProjectRead, LocalProjectUpdate
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(prefix="/projects", tags=["projects"], dependencies=[Depends(require_organization_access)])


@router.get("", response_model=list[LocalProjectRead])
def list_local_projects(
    active_only: bool = Query(default=False),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> list[LocalProject]:
    statement: Select[tuple[LocalProject]] = select(LocalProject)
    if active_only:
        statement = statement.where(LocalProject.is_active.is_(True))
    if search:
        pattern = f"%{search.strip()}%"
        statement = statement.where(
            or_(
                LocalProject.project_code.ilike(pattern),
                LocalProject.name.ilike(pattern),
                LocalProject.description.ilike(pattern),
            )
        )
    statement = statement.order_by(LocalProject.name.asc(), LocalProject.project_code.asc())
    return list(db.scalars(statement).all())


@router.post("", response_model=LocalProjectRead, status_code=status.HTTP_201_CREATED)
def create_local_project(payload: LocalProjectCreate, current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)) -> LocalProject:
    duplicate = db.scalar(
        select(LocalProject).where(
            or_(
                func.lower(LocalProject.project_code) == payload.project_code.lower(),
                func.lower(LocalProject.name) == payload.name.lower(),
            )
        )
    )
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Codice o nome commessa gia esistente.")

    project = LocalProject(**payload.model_dump())
    db.add(project)
    record_audit_log(db, action="create", entity="local_project", actor_name=current_user.username, user_id=current_user.id, detail=payload.model_dump())
    db.commit()
    db.refresh(project)
    return project


@router.put("/{project_id}", response_model=LocalProjectRead)
def update_local_project(project_id: str, payload: LocalProjectUpdate, current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)) -> LocalProject:
    project = db.get(LocalProject, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commessa non trovata.")

    values = payload.model_dump(exclude_unset=True)
    if "project_code" in values:
        duplicate = db.scalar(
            select(LocalProject).where(
                func.lower(LocalProject.project_code) == values["project_code"].lower(),
                LocalProject.id != project_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Codice commessa gia esistente.")
    if "name" in values:
        duplicate = db.scalar(
            select(LocalProject).where(
                func.lower(LocalProject.name) == values["name"].lower(),
                LocalProject.id != project_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nome commessa gia esistente.")

    previous = LocalProjectRead.model_validate(project).model_dump(mode="json")
    for field, value in values.items():
        setattr(project, field, value)

    record_audit_log(
        db,
        action="update",
        entity="local_project",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"before": previous, "after": LocalProjectRead.model_validate(project).model_dump(mode="json")},
    )
    db.commit()
    db.refresh(project)
    return project


@router.delete("/{project_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_local_project(project_id: str, current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db)) -> None:
    project = db.get(LocalProject, project_id)
    if project is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Commessa non trovata.")

    linked_mapping = db.scalar(
        select(TimesheetMapping).where(
            TimesheetMapping.mapping_type == "project",
            TimesheetMapping.internal_key == project.id,
        ).limit(1)
    )
    if linked_mapping is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Commessa usata nei mapping rendicontazioni. Rimuovi prima i collegamenti.",
        )

    record_audit_log(
        db,
        action="delete",
        entity="local_project",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=LocalProjectRead.model_validate(project).model_dump(mode="json"),
    )
    db.delete(project)
    db.commit()

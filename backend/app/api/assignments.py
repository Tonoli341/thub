from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func as sqlfunc, select
from sqlalchemy.orm import Session

from app.api.deps import require_manager_or_above
from app.db import get_db
from app.models import Assignment, Employee, OperationalArea, User
from app.schemas import AssignmentCreate, AssignmentRead, AssignmentUpdate
from app.services.audit import record_audit_log
from app.services.security import get_current_user

router = APIRouter(prefix="/assignments", tags=["assignments"], dependencies=[Depends(require_manager_or_above)])


def _get_allowed_buildings(db: Session, area: str | None) -> set[str]:
    """Restituisce i buildings ammessi per l'area, letti dal DB. Vuoto = nessun vincolo."""
    area_key = (area or "").strip().upper()
    if not area_key:
        return set()
    op_area = db.scalar(
        select(OperationalArea).where(
            (sqlfunc.upper(OperationalArea.name) == area_key)
            | (sqlfunc.upper(OperationalArea.area_code) == area_key)
        ).limit(1)
    )
    if op_area is None:
        return set()
    buildings: list = op_area.buildings or []
    return {b.upper() for b in buildings}


def normalize_assignment_immobile(area: str | None, immobile: str | None, *, required: bool, db: Session) -> str | None:
    allowed_values = _get_allowed_buildings(db, area)
    if not allowed_values:
        return None

    normalized = (immobile or "").strip().upper()
    if normalized in allowed_values:
        return normalized

    if required:
        allowed_list = ", ".join(sorted(allowed_values))
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Immobile obbligatorio per {area}. Valori ammessi: {allowed_list}.",
        )
    return None


def serialize_assignment(assignment: Assignment) -> AssignmentRead:
    return AssignmentRead(
        id=assignment.id,
        employee_id=assignment.employee_id,
        employee_name=assignment.employee.full_name,
        work_date=assignment.work_date,
        start_time=assignment.start_time,
        end_time=assignment.end_time,
        cause=assignment.cause,
        site=assignment.site,
        area=assignment.area,
        immobile=assignment.immobile,
        customer=assignment.customer,
        activity=assignment.activity,
        notes=assignment.notes,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
    )


def check_no_overlap(db: Session, employee_id: str, work_date: date, start_time, end_time, exclude_id: str | None = None) -> None:
    stmt = select(Assignment).where(
        Assignment.employee_id == employee_id,
        Assignment.work_date == work_date,
        Assignment.start_time < end_time,
        Assignment.end_time > start_time,
    )
    if exclude_id:
        stmt = stmt.where(Assignment.id != exclude_id)
    existing = db.scalar(stmt)
    if existing:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="L'orario si sovrappone a un'altra assegnazione esistente.",
        )


@router.get("", response_model=list[AssignmentRead])
def list_assignments(
    start: date = Query(...),
    end: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[AssignmentRead]:
    assignments = db.scalars(
        select(Assignment)
        .join(Assignment.employee)
        .where(Assignment.work_date >= start, Assignment.work_date <= end)
        .order_by(Assignment.work_date.asc(), Employee.full_name.asc())
    ).all()
    return [serialize_assignment(item) for item in assignments]


@router.post("", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentRead:
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    check_no_overlap(db, payload.employee_id, payload.work_date, payload.start_time, payload.end_time)

    values = payload.model_dump()
    if not values.get("area") and employee.default_operational_area is not None:
        values["area"] = employee.default_operational_area.name
    values["immobile"] = normalize_assignment_immobile(values.get("area"), values.get("immobile"), required=True, db=db)

    assignment = Assignment(**values)
    db.add(assignment)
    record_audit_log(db, action="create", entity="assignment", actor_name=current_user.username, detail=payload.model_dump(mode="json"))
    db.commit()
    db.refresh(assignment)
    return serialize_assignment(assignment)


@router.put("/{assignment_id}", response_model=AssignmentRead)
def update_assignment(
    assignment_id: str,
    payload: AssignmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> AssignmentRead:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    changes = payload.model_dump(exclude_unset=True)
    new_start = changes.get("start_time", assignment.start_time)
    new_end = changes.get("end_time", assignment.end_time)
    check_no_overlap(db, assignment.employee_id, assignment.work_date, new_start, new_end, exclude_id=assignment_id)

    if "area" in changes or "immobile" in changes:
        effective_area = changes.get("area", assignment.area)
        effective_immobile = changes.get("immobile", assignment.immobile)
        changes["immobile"] = normalize_assignment_immobile(effective_area, effective_immobile, required=True, db=db)

    previous_state = serialize_assignment(assignment).model_dump(mode="json")
    for field, value in changes.items():
        setattr(assignment, field, value)

    record_audit_log(
        db,
        action="update",
        entity="assignment",
        actor_name=current_user.username,
        detail={"before": previous_state, "after": serialize_assignment(assignment).model_dump(mode="json")},
    )
    db.commit()
    db.refresh(assignment)
    return serialize_assignment(assignment)


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(
    assignment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")

    record_audit_log(db, action="delete", entity="assignment", actor_name=current_user.username, detail={"id": assignment_id})
    db.delete(assignment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

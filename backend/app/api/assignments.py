from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func as sqlfunc, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import get_impersonation_employee
from app.db import get_db
from app.enums import AssignmentCause
from app.models import Assignment, Employee, OperationalArea, TrainingCourse, User
from app.schemas import AssignmentCreate, AssignmentRead, AssignmentUpdate
from app.services.audit import record_audit_log
from app.services.hierarchy import collect_report_ids
from app.services.portal_auth import build_auth_user_read, build_impersonation_view, planner_level_can_write, planner_level_scope
from app.services.security import get_current_user

router = APIRouter(prefix="/assignments", tags=["assignments"])


def _planner_allowed_employee_ids(
    db: Session,
    current_user: User,
    *,
    write: bool,
    impersonate_employee: Employee | None = None,
) -> set[str] | None:
    auth = build_impersonation_view(db, impersonate_employee) if impersonate_employee is not None else build_auth_user_read(db, current_user)
    if not auth.can_access_planning:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso planner non consentito.")

    if write and not planner_level_can_write(auth.planner_access_level):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Permessi di scrittura planner non consentiti.")

    scope = planner_level_scope(auth.planner_access_level)
    if scope == "all":
        return None
    if auth.linked_employee_id is None:
        return set()
    if scope == "team":
        return {auth.linked_employee_id, *collect_report_ids(db, auth.linked_employee_id)}
    return {auth.linked_employee_id}


def _effective_role(db: Session, current_user: User, impersonate_employee: Employee | None) -> str | None:
    auth = build_impersonation_view(db, impersonate_employee) if impersonate_employee is not None else build_auth_user_read(db, current_user)
    return auth.effective_role


def _resolve_training_course(db: Session, cause, training_course_id: str | None) -> str | None:
    """Valida la coerenza tra causale FORMAZIONE e corso.
    Il corso è obbligatorio per la formazione e non ammesso per le altre causali."""
    if cause == AssignmentCause.formazione:
        if not training_course_id:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Per la formazione è obbligatorio selezionare il titolo del corso.",
            )
        course = db.get(TrainingCourse, training_course_id)
        if course is None or not course.is_active:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Titolo corso non valido.")
        return training_course_id
    return None


def _get_allowed_buildings(db: Session, area: str | None) -> set[str]:
    """Restituisce i buildings ammessi per l'area nel Planner, letti dal DB.
    Vuoto = nessun vincolo. Esclude gli immobili con visible_in_planner=False:
    per quelli il Planner mostra solo l'area, senza dettaglio immobile."""
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
    allowed: set[str] = set()
    for entry in op_area.buildings or []:
        if isinstance(entry, str):
            allowed.add(entry.strip().upper())
        elif entry.get("visible_in_planner", True):
            code = str(entry.get("code") or "").strip().upper()
            if code:
                allowed.add(code)
    return allowed


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
        break_start=assignment.break_start,
        break_end=assignment.break_end,
        cause=assignment.cause,
        site=assignment.site,
        area=assignment.area,
        immobile=assignment.immobile,
        customer=assignment.customer,
        activity=assignment.activity,
        notes=assignment.notes,
        workload=assignment.workload,
        training_course_id=assignment.training_course_id,
        training_course_title=assignment.training_course.title if assignment.training_course else None,
        created_at=assignment.created_at,
        updated_at=assignment.updated_at,
    )


def normalize_assignment_break(start_time, end_time, break_start, break_end):
    if break_start is None and break_end is None:
        return None, None
    if break_start is None or break_end is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Per la pausa servono sia l'orario di inizio sia l'orario di fine.",
        )
    if not (start_time < break_start < break_end < end_time):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="La pausa deve essere compresa dentro l'assegnazione.",
        )
    return break_start, break_end


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
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> list[AssignmentRead]:
    allowed_employee_ids = _planner_allowed_employee_ids(db, current_user, write=False, impersonate_employee=impersonate_employee)
    statement = (
        select(Assignment)
        .join(Assignment.employee)
        .options(selectinload(Assignment.training_course))
        .where(Assignment.work_date >= start, Assignment.work_date <= end)
        .order_by(Assignment.work_date.asc(), Employee.full_name.asc())
    )
    if allowed_employee_ids is not None:
        if not allowed_employee_ids:
            return []
        statement = statement.where(Assignment.employee_id.in_(allowed_employee_ids))
    assignments = db.scalars(statement).all()
    return [serialize_assignment(item) for item in assignments]


@router.post("", response_model=AssignmentRead, status_code=status.HTTP_201_CREATED)
def create_assignment(
    payload: AssignmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> AssignmentRead:
    allowed_employee_ids = _planner_allowed_employee_ids(db, current_user, write=True, impersonate_employee=impersonate_employee)
    if allowed_employee_ids is not None and payload.employee_id not in allowed_employee_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non puoi creare allocazioni per questo dipendente.")
    employee = db.get(Employee, payload.employee_id)
    if employee is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Employee not found.")

    is_training = payload.cause == AssignmentCause.formazione
    if is_training and _effective_role(db, current_user, impersonate_employee) not in ("admin", "hr"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli utenti HR possono inserire ore di formazione.")

    check_no_overlap(db, payload.employee_id, payload.work_date, payload.start_time, payload.end_time)

    values = payload.model_dump()
    values["training_course_id"] = _resolve_training_course(db, payload.cause, values.get("training_course_id"))
    if is_training:
        # La formazione registra solo corso + fascia oraria: nessun building/immobile.
        values["area"] = None
        values["immobile"] = None
    else:
        if not values.get("area") and employee.default_operational_area is not None:
            values["area"] = employee.default_operational_area.name
        values["immobile"] = normalize_assignment_immobile(values.get("area"), values.get("immobile"), required=True, db=db)
    values["break_start"], values["break_end"] = normalize_assignment_break(
        values["start_time"],
        values["end_time"],
        values.get("break_start"),
        values.get("break_end"),
    )

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
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> AssignmentRead:
    allowed_employee_ids = _planner_allowed_employee_ids(db, current_user, write=True, impersonate_employee=impersonate_employee)
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    if allowed_employee_ids is not None and assignment.employee_id not in allowed_employee_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non puoi modificare allocazioni per questo dipendente.")

    changes = payload.model_dump(exclude_unset=True)
    effective_cause = changes.get("cause", assignment.cause)
    is_training = effective_cause == AssignmentCause.formazione
    if (is_training or assignment.cause == AssignmentCause.formazione) and _effective_role(db, current_user, impersonate_employee) not in ("admin", "hr"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo gli utenti HR possono modificare ore di formazione.")

    new_start = changes.get("start_time", assignment.start_time)
    new_end = changes.get("end_time", assignment.end_time)
    check_no_overlap(db, assignment.employee_id, assignment.work_date, new_start, new_end, exclude_id=assignment_id)

    if "start_time" in changes or "end_time" in changes or "break_start" in changes or "break_end" in changes:
        changes["break_start"], changes["break_end"] = normalize_assignment_break(
            new_start,
            new_end,
            changes.get("break_start", assignment.break_start),
            changes.get("break_end", assignment.break_end),
        )

    if is_training:
        effective_course = changes.get("training_course_id", assignment.training_course_id)
        changes["training_course_id"] = _resolve_training_course(db, effective_cause, effective_course)
        # La formazione non ha building/immobile associati.
        changes["area"] = None
        changes["immobile"] = None
    else:
        if "cause" in changes or "training_course_id" in changes:
            changes["training_course_id"] = None
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
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> Response:
    allowed_employee_ids = _planner_allowed_employee_ids(db, current_user, write=True, impersonate_employee=impersonate_employee)
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assignment not found.")
    if allowed_employee_ids is not None and assignment.employee_id not in allowed_employee_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non puoi eliminare allocazioni per questo dipendente.")

    record_audit_log(db, action="delete", entity="assignment", actor_name=current_user.username, detail={"id": assignment_id})
    db.delete(assignment)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)

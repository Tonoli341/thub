import csv
import io
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session, selectinload

from app.api.deps import require_admin_or_hr
from app.db import get_db
from app.enums import AssignmentCause
from app.models import Assignment, TrainingCourse, TrainingMacroArea, User
from app.schemas import (
    TrainingCourseCreate,
    TrainingCourseRead,
    TrainingCourseUpdate,
    TrainingHoursReport,
    TrainingHoursRow,
    TrainingMacroAreaCreate,
    TrainingMacroAreaRead,
    TrainingMacroAreaUpdate,
)
from app.services.audit import record_audit_log
from app.services.security import get_current_user

macro_areas_router = APIRouter(prefix="/training-macro-areas", tags=["training"])
courses_router = APIRouter(prefix="/training-courses", tags=["training"])
report_router = APIRouter(prefix="/training", tags=["training"])


# ── Macro aree ──────────────────────────────────────────────────────────────
def _serialize_macro_area(area: TrainingMacroArea) -> TrainingMacroAreaRead:
    return TrainingMacroAreaRead.model_validate(area)


@macro_areas_router.get("", response_model=list[TrainingMacroAreaRead])
def list_macro_areas(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[TrainingMacroArea]:
    statement = select(TrainingMacroArea)
    if active_only:
        statement = statement.where(TrainingMacroArea.is_active.is_(True))
    statement = statement.order_by(TrainingMacroArea.name.asc())
    return list(db.scalars(statement).all())


@macro_areas_router.post("", response_model=TrainingMacroAreaRead, status_code=status.HTTP_201_CREATED)
def create_macro_area(
    payload: TrainingMacroAreaCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> TrainingMacroArea:
    name = payload.name.strip()
    duplicate = db.scalar(select(TrainingMacroArea).where(func.lower(TrainingMacroArea.name) == name.lower()))
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già una macro area con questo nome.")
    area = TrainingMacroArea(name=name, is_active=payload.is_active)
    db.add(area)
    record_audit_log(db, action="create", entity="training_macro_area", actor_name=current_user.username, detail={"name": name})
    db.commit()
    db.refresh(area)
    return area


@macro_areas_router.put("/{area_id}", response_model=TrainingMacroAreaRead)
def update_macro_area(
    area_id: str,
    payload: TrainingMacroAreaUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> TrainingMacroArea:
    area = db.get(TrainingMacroArea, area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro area non trovata.")
    changes = payload.model_dump(exclude_unset=True)
    if "name" in changes and changes["name"] is not None:
        name = changes["name"].strip()
        duplicate = db.scalar(
            select(TrainingMacroArea).where(
                func.lower(TrainingMacroArea.name) == name.lower(),
                TrainingMacroArea.id != area_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già una macro area con questo nome.")
        changes["name"] = name
    for field, value in changes.items():
        setattr(area, field, value)
    record_audit_log(db, action="update", entity="training_macro_area", actor_name=current_user.username, detail={"id": area_id, **changes})
    db.commit()
    db.refresh(area)
    return area


@macro_areas_router.delete("/{area_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_macro_area(
    area_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> Response:
    area = db.get(TrainingMacroArea, area_id)
    if area is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Macro area non trovata.")
    in_use = db.scalar(select(func.count()).select_from(TrainingCourse).where(TrainingCourse.macro_area_id == area_id))
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Impossibile eliminare: la macro area è associata ad almeno un corso. Disattivala oppure riassegna i corsi.",
        )
    record_audit_log(db, action="delete", entity="training_macro_area", actor_name=current_user.username, detail={"id": area_id})
    db.delete(area)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Corsi ───────────────────────────────────────────────────────────────────
def _serialize_course(course: TrainingCourse) -> TrainingCourseRead:
    data = TrainingCourseRead.model_validate(course)
    data.macro_area_name = course.macro_area.name if course.macro_area else None
    return data


@courses_router.get("", response_model=list[TrainingCourseRead])
def list_courses(
    active_only: bool = Query(default=False),
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[TrainingCourseRead]:
    statement = select(TrainingCourse).options(selectinload(TrainingCourse.macro_area))
    if active_only:
        statement = statement.where(TrainingCourse.is_active.is_(True))
    statement = statement.order_by(TrainingCourse.title.asc())
    return [_serialize_course(course) for course in db.scalars(statement).all()]


def _validate_macro_area(db: Session, macro_area_id: str | None) -> None:
    if macro_area_id and db.get(TrainingMacroArea, macro_area_id) is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Macro area non valida.")


@courses_router.post("", response_model=TrainingCourseRead, status_code=status.HTTP_201_CREATED)
def create_course(
    payload: TrainingCourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> TrainingCourseRead:
    title = payload.title.strip()
    duplicate = db.scalar(select(TrainingCourse).where(func.lower(TrainingCourse.title) == title.lower()))
    if duplicate is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già un corso con questo titolo.")
    _validate_macro_area(db, payload.macro_area_id)
    course = TrainingCourse(title=title, macro_area_id=payload.macro_area_id, is_active=payload.is_active)
    db.add(course)
    record_audit_log(db, action="create", entity="training_course", actor_name=current_user.username, detail={"title": title})
    db.commit()
    db.refresh(course)
    return _serialize_course(course)


@courses_router.put("/{course_id}", response_model=TrainingCourseRead)
def update_course(
    course_id: str,
    payload: TrainingCourseUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> TrainingCourseRead:
    course = db.get(TrainingCourse, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Corso non trovato.")
    changes = payload.model_dump(exclude_unset=True)
    if "title" in changes and changes["title"] is not None:
        title = changes["title"].strip()
        duplicate = db.scalar(
            select(TrainingCourse).where(
                func.lower(TrainingCourse.title) == title.lower(),
                TrainingCourse.id != course_id,
            )
        )
        if duplicate is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Esiste già un corso con questo titolo.")
        changes["title"] = title
    if "macro_area_id" in changes:
        _validate_macro_area(db, changes["macro_area_id"])
    for field, value in changes.items():
        setattr(course, field, value)
    record_audit_log(db, action="update", entity="training_course", actor_name=current_user.username, detail={"id": course_id, **changes})
    db.commit()
    db.refresh(course)
    return _serialize_course(course)


@courses_router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin_or_hr),
) -> Response:
    course = db.get(TrainingCourse, course_id)
    if course is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Corso non trovato.")
    in_use = db.scalar(select(func.count()).select_from(Assignment).where(Assignment.training_course_id == course_id))
    if in_use:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Impossibile eliminare: il corso è usato in una o più assegnazioni di formazione. Disattivalo invece di eliminarlo.",
        )
    record_audit_log(db, action="delete", entity="training_course", actor_name=current_user.username, detail={"id": course_id})
    db.delete(course)
    db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ── Report ore formazione ─────────────────────────────────────────────────────
def _assignment_hours(assignment: Assignment) -> float:
    start = datetime.combine(date.min, assignment.start_time)
    end = datetime.combine(date.min, assignment.end_time)
    minutes = (end - start).total_seconds() / 60
    if assignment.break_start and assignment.break_end:
        bstart = datetime.combine(date.min, assignment.break_start)
        bend = datetime.combine(date.min, assignment.break_end)
        minutes -= (bend - bstart).total_seconds() / 60
    return round(max(minutes, 0) / 60, 2)


def _build_report(db: Session, start: date, end: date, employee_id: str | None) -> TrainingHoursReport:
    statement = (
        select(Assignment)
        .join(Assignment.employee)
        .options(selectinload(Assignment.employee), selectinload(Assignment.training_course).selectinload(TrainingCourse.macro_area))
        .where(
            Assignment.cause == AssignmentCause.formazione,
            Assignment.work_date >= start,
            Assignment.work_date <= end,
        )
    )
    if employee_id:
        statement = statement.where(Assignment.employee_id == employee_id)

    grouped: dict[tuple[str, str | None], TrainingHoursRow] = {}
    ordering: list[tuple[str, str | None]] = []
    total = 0.0
    for assignment in db.scalars(statement).all():
        hours = _assignment_hours(assignment)
        total += hours
        key = (assignment.employee_id, assignment.training_course_id)
        if key not in grouped:
            course = assignment.training_course
            grouped[key] = TrainingHoursRow(
                employee_id=assignment.employee_id,
                employee_name=assignment.employee.full_name,
                training_course_id=assignment.training_course_id,
                course_title=course.title if course else None,
                macro_area_name=course.macro_area.name if course and course.macro_area else None,
                hours=0.0,
            )
            ordering.append(key)
        grouped[key].hours = round(grouped[key].hours + hours, 2)

    rows = sorted(
        (grouped[key] for key in ordering),
        key=lambda r: (r.employee_name.lower(), (r.course_title or "").lower()),
    )
    return TrainingHoursReport(start=start, end=end, total_hours=round(total, 2), rows=rows)


@report_router.get("/hours-report", response_model=TrainingHoursReport)
def training_hours_report(
    start: date = Query(...),
    end: date = Query(...),
    employee_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
) -> TrainingHoursReport:
    return _build_report(db, start, end, employee_id)


@report_router.get("/hours-report.csv")
def training_hours_report_csv(
    start: date = Query(...),
    end: date = Query(...),
    employee_id: str | None = Query(default=None),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin_or_hr),
) -> Response:
    report = _build_report(db, start, end, employee_id)
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Dipendente", "Corso", "Macro area", "Ore"])
    for row in report.rows:
        writer.writerow([
            row.employee_name,
            row.course_title or "(nessun corso)",
            row.macro_area_name or "",
            f"{row.hours:.2f}".replace(".", ","),
        ])
    writer.writerow([])
    writer.writerow(["Totale", "", "", f"{report.total_hours:.2f}".replace(".", ",")])
    filename = f"formazione_{start.isoformat()}_{end.isoformat()}.csv"
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )

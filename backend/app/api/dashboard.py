from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Query
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.enums import JustificationApprovalStatus
from app.models import Assignment, Employee, Justification, User
from app.schemas import (
    ApproverDashboardResponse,
    ApproverRequestItem,
    DashboardDetail,
    DashboardResponse,
    MyDashboardResponse,
    PersonalAssignmentItem,
    TeamAbsentItem,
    TeamAllocationArea,
    UpcomingAbsenceItem,
)
from app.services.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


@router.get("", response_model=DashboardResponse)
def get_dashboard(
    target_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
) -> DashboardResponse:
    from sqlalchemy import func

    total_active = db.scalar(
        select(func.count()).select_from(Employee).where(Employee.is_active.is_(True))
    ) or 0

    company_rows = db.execute(
        select(Employee.datore_lavoro, func.count().label("n"))
        .where(Employee.is_active.is_(True))
        .group_by(Employee.datore_lavoro)
        .order_by(func.count().desc())
    ).all()
    active_by_company = {
        (row.datore_lavoro or "Non specificato"): row.n
        for row in company_rows
    }

    # Employees with planner assignments today
    present_rows = db.execute(
        select(Employee.id, Employee.full_name, Assignment.area)
        .join(Assignment, Assignment.employee_id == Employee.id)
        .where(Assignment.work_date == target_date)
        .order_by(Employee.full_name)
    ).all()

    emp_areas: dict[str, tuple[str, list[str]]] = {}
    for emp_id, emp_name, area in present_rows:
        if emp_id not in emp_areas:
            emp_areas[emp_id] = (emp_name, [])
        if area:
            emp_areas[emp_id][1].append(area)

    present_detail = [
        DashboardDetail(
            employee_id=emp_id,
            employee_name=name,
            info=", ".join(sorted(set(areas))) if areas else "—",
        )
        for emp_id, (name, areas) in emp_areas.items()
    ]

    area_employees: dict[str, list[str]] = {}
    for _emp_id, (name, areas) in emp_areas.items():
        for area in (set(areas) if areas else {"Senza area"}):
            area_employees.setdefault(area, []).append(name)

    present_by_area = [
        DashboardDetail(
            employee_id=area,
            employee_name=area,
            info=", ".join(sorted(names)),
        )
        for area, names in sorted(area_employees.items())
    ]

    # Employees absent today (justification covering target_date, not rejected)
    absent_rows = db.execute(
        select(
            Employee.id, Employee.full_name,
            Justification.justification_type,
            Justification.start_date, Justification.end_date,
        )
        .join(Justification, Justification.employee_id == Employee.id)
        .where(
            Justification.start_date <= target_date,
            Justification.end_date >= target_date,
            Justification.approval_status != JustificationApprovalStatus.rejected,
        )
        .order_by(Employee.full_name)
    ).all()

    absent_detail = [
        DashboardDetail(
            employee_id=emp_id,
            employee_name=emp_name,
            info=f"{jtype} · {sd.strftime('%d/%m')}–{ed.strftime('%d/%m')}",
        )
        for emp_id, emp_name, jtype, sd, ed in absent_rows
    ]

    # Future pending approvals (start_date >= today)
    pending_rows = db.execute(
        select(
            Employee.id, Employee.full_name,
            Justification.justification_type,
            Justification.start_date, Justification.end_date,
        )
        .join(Justification, Justification.employee_id == Employee.id)
        .where(
            Justification.approval_status == JustificationApprovalStatus.pending,
            Justification.start_date >= target_date,
        )
        .order_by(Justification.start_date, Employee.full_name)
    ).all()

    pending_detail = [
        DashboardDetail(
            employee_id=emp_id,
            employee_name=emp_name,
            info=f"{jtype} · {sd.strftime('%d/%m')}–{ed.strftime('%d/%m')}",
        )
        for emp_id, emp_name, jtype, sd, ed in pending_rows
    ]

    return DashboardResponse(
        target_date=target_date,
        total_active_employees=total_active,
        active_by_company=active_by_company,
        present_count=len(present_detail),
        absent_count=len(absent_detail),
        pending_approvals_count=len(pending_detail),
        present_detail=present_detail,
        present_by_area=present_by_area,
        absent_today_detail=absent_detail,
        pending_approvals_detail=pending_detail,
    )


@router.get("/me", response_model=MyDashboardResponse)
def get_my_dashboard(
    employee_id: str = Query(),
    target_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
) -> MyDashboardResponse:
    # ── personal: today's assignments ──
    personal_rows = db.execute(
        select(Assignment.area, Assignment.site, Assignment.start_time, Assignment.end_time)
        .where(
            Assignment.employee_id == employee_id,
            Assignment.work_date == target_date,
        )
        .order_by(Assignment.start_time)
    ).all()

    today_assignments = [
        PersonalAssignmentItem(
            area=r.area,
            site=r.site,
            start_time=str(r.start_time)[:5] if r.start_time else None,
            end_time=str(r.end_time)[:5] if r.end_time else None,
        )
        for r in personal_rows
    ]

    # ── personal: upcoming absences (next 60 days, not rejected) ──
    look_ahead = target_date + timedelta(days=60)
    upcoming_rows = db.execute(
        select(
            Justification.id,
            Justification.justification_type,
            Justification.start_date,
            Justification.end_date,
            Justification.approval_status,
        )
        .where(
            Justification.employee_id == employee_id,
            Justification.end_date >= target_date,
            Justification.start_date <= look_ahead,
            Justification.approval_status != JustificationApprovalStatus.rejected,
        )
        .order_by(Justification.start_date)
    ).all()

    upcoming_absences = [
        UpcomingAbsenceItem(
            id=row.id,
            justification_type=row.justification_type.value,
            start_date=row.start_date,
            end_date=row.end_date,
            approval_status=row.approval_status.value,
        )
        for row in upcoming_rows
    ]
    pending_count = sum(
        1 for a in upcoming_absences if a.approval_status == JustificationApprovalStatus.pending.value
    )

    # ── team: direct reports ──
    team_rows = db.execute(
        select(Employee.id, Employee.full_name)
        .where(
            Employee.manager_employee_id == employee_id,
            Employee.is_active.is_(True),
        )
        .order_by(Employee.full_name)
    ).all()
    team_ids = [r.id for r in team_rows]

    team_absent_today: list[TeamAbsentItem] = []
    team_allocations: list[TeamAllocationArea] = []

    if team_ids:
        absent_rows = db.execute(
            select(
                Employee.id,
                Employee.full_name,
                Justification.justification_type,
                Justification.start_date,
                Justification.end_date,
            )
            .join(Justification, Justification.employee_id == Employee.id)
            .where(
                Employee.id.in_(team_ids),
                Justification.start_date <= target_date,
                Justification.end_date >= target_date,
                Justification.approval_status != JustificationApprovalStatus.rejected,
            )
            .order_by(Employee.full_name)
        ).all()

        team_absent_today = [
            TeamAbsentItem(
                employee_id=row[0],
                employee_name=row[1],
                justification_type=row[2].value,
                start_date=row[3],
                end_date=row[4],
            )
            for row in absent_rows
        ]

        alloc_rows = db.execute(
            select(Employee.id, Employee.full_name, Assignment.area)
            .join(Assignment, Assignment.employee_id == Employee.id)
            .where(
                Employee.id.in_(team_ids),
                Assignment.work_date == target_date,
            )
            .order_by(Employee.full_name)
        ).all()

        alloc_map: dict[str, list[str]] = {}
        seen: dict[str, set] = {}
        for emp_id, emp_name, area in alloc_rows:
            key = area or "Senza area"
            seen.setdefault(emp_id, set())
            if key not in seen[emp_id]:
                seen[emp_id].add(key)
                alloc_map.setdefault(key, []).append(emp_name)

        team_allocations = [
            TeamAllocationArea(area=area, employee_names=sorted(names), count=len(names))
            for area, names in sorted(alloc_map.items())
        ]

    return MyDashboardResponse(
        today_assignments=today_assignments,
        upcoming_absences=upcoming_absences,
        pending_count=pending_count,
        team_size=len(team_ids),
        team_absent_today=team_absent_today,
        team_allocations=team_allocations,
    )


@router.get("/approver", response_model=ApproverDashboardResponse)
def get_approver_dashboard(
    employee_id: str = Query(),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> ApproverDashboardResponse:
    is_approver = or_(
        Justification.approver_1_employee_id == employee_id,
        Justification.approver_2_employee_id == employee_id,
        Justification.approver_3_employee_id == employee_id,
    )

    pending_rows = db.scalars(
        select(Justification)
        .options(selectinload(Justification.employee))
        .where(Justification.approval_status == JustificationApprovalStatus.pending, is_approver)
        .order_by(Justification.start_date.asc())
    ).all()

    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    recent_rows = db.scalars(
        select(Justification)
        .options(selectinload(Justification.employee))
        .where(
            Justification.approval_status.in_([JustificationApprovalStatus.approved, JustificationApprovalStatus.rejected]),
            is_approver,
            Justification.updated_at >= cutoff,
        )
        .order_by(Justification.updated_at.desc())
        .limit(15)
    ).all()

    def to_item(j: Justification) -> ApproverRequestItem:
        return ApproverRequestItem(
            justification_id=j.id,
            employee_id=j.employee_id,
            employee_name=j.employee.full_name,
            justification_type=j.justification_type.value,
            start_date=j.start_date,
            end_date=j.end_date,
            approval_status=j.approval_status.value,
            created_at=j.created_at,
            updated_at=j.updated_at,
        )

    return ApproverDashboardResponse(
        pending_requests=[to_item(j) for j in pending_rows],
        recent_processed=[to_item(j) for j in recent_rows],
    )

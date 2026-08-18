from datetime import date

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import User
from app.operational_reporting_schemas import (
    ReportingCustomerRead,
    ReportingDashboardRead,
    ReportingDayContextRead,
    ReportingDaySave,
    ReportingMemberRead,
)
from app.services.operational_reporting import (
    build_dashboard,
    build_day_context,
    confirm_day,
    list_eligible_customers,
    reset_day,
    reset_member,
    save_day,
)
from app.services.security import get_current_user


router = APIRouter(prefix="/operational-reporting", tags=["operational-reporting"])


@router.get("/customers", response_model=list[ReportingCustomerRead])
def eligible_customers(
    area_id: str = Query(...),
    building: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> list[dict]:
    return list_eligible_customers(db, current_user, area_id, building)


@router.get("/day", response_model=ReportingDayContextRead)
def day_context(
    day: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return build_day_context(db, current_user, day)


@router.get("/dashboard", response_model=ReportingDashboardRead)
def dashboard(
    start_date: date = Query(...),
    end_date: date = Query(...),
    team_id: str | None = Query(default=None),
    employee_id: str | None = Query(default=None),
    customer_code: str | None = Query(default=None),
    jupiter_description: str | None = Query(default=None),
    area_id: str | None = Query(default=None),
    building: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return build_dashboard(
        db,
        current_user,
        start_date,
        end_date,
        team_id,
        employee_id,
        customer_code,
        jupiter_description,
        area_id,
        building,
    )


@router.put("/day", response_model=ReportingMemberRead)
def autosave_day(
    payload: ReportingDaySave,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return save_day(db, current_user, payload)


@router.post("/day/reset", response_model=ReportingDayContextRead)
def reset_report_from_planner(
    day: date = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return reset_day(db, current_user, day)


@router.post("/day/reset-member", response_model=ReportingMemberRead)
def reset_member_from_planner(
    day: date = Query(...),
    employee_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return reset_member(db, current_user, employee_id, day)


@router.post("/{report_id}/confirm", response_model=ReportingMemberRead)
def confirm_report(
    report_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> dict:
    return confirm_day(db, current_user, report_id)

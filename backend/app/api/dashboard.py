import threading
import time
from datetime import date, datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import or_, select
from sqlalchemy.orm import Session, selectinload

from app.db import get_db
from app.enums import AssignmentCause, JustificationApprovalStatus
from app.models import Assignment, Employee, Justification, User
from app.schemas import (
    DashboardAreaPerson,
    ApproverDashboardResponse,
    ApproverRequestItem,
    DashboardDetail,
    DashboardBirthdayItem,
    DashboardBirthdaysResponse,
    DashboardExpirationItem,
    DashboardExpirationsResponse,
    DashboardResponse,
    MyDashboardResponse,
    PersonalAssignmentItem,
    TeamAbsentItem,
    TeamAllocationArea,
    UpcomingAbsenceItem,
)
from app.api.deps import get_impersonation_employee
from app.services.absence_permissions import get_linked_tms_employee, list_pending_justifications_for_approver
from app.services.hierarchy import collect_report_ids
from app.services.portal_auth import build_auth_user_read, build_impersonation_view
from app.services.security import get_current_user
from app.services.timeutils import today_local
from app.services.tms import fetch_all_employee_expirations_from_tms

# Raccoglitore delle allocazioni senza area, come nel riepilogo del Planner.
NO_AREA_LABEL = "Senza area"

# Formazione e visita idoneita' non hanno area/immobile (vedi editingBlock in
# PlannerPage.jsx: il payload di queste due cause non li invia mai): senza
# questa etichetta finirebbero confuse dentro "Senza area" con chi non ha
# davvero un'area assegnata.
CAUSE_LABELS = {
    AssignmentCause.formazione: "🎓 Formazione",
    AssignmentCause.visita_idoneita: "🩺 Visita idoneità",
}

router = APIRouter(prefix="/dashboard", tags=["dashboard"])


def _birthday_in_year(birth_date: date, year: int) -> date:
    try:
        return birth_date.replace(year=year)
    except ValueError:
        # Il 29 febbraio viene celebrato il 28 negli anni non bisestili.
        return date(year, 2, 28)


@router.get("/birthdays", response_model=DashboardBirthdaysResponse)
def get_upcoming_birthdays(
    days: int = Query(default=7, ge=0, le=31),
    db: Session = Depends(get_db),
) -> DashboardBirthdaysResponse:
    today = today_local()
    employees = db.scalars(
        select(Employee)
        .where(Employee.is_active.is_(True), Employee.birth_date.is_not(None))
        .order_by(Employee.full_name)
    ).all()
    items: list[DashboardBirthdayItem] = []
    for employee in employees:
        next_birthday = _birthday_in_year(employee.birth_date, today.year)
        if next_birthday < today:
            next_birthday = _birthday_in_year(employee.birth_date, today.year + 1)
        days_remaining = (next_birthday - today).days
        if days_remaining <= days:
            items.append(DashboardBirthdayItem(
                employee_id=employee.id,
                employee_name=employee.full_name,
                birth_date=employee.birth_date,
                next_birthday=next_birthday,
                days_remaining=days_remaining,
            ))
    items.sort(key=lambda item: (item.days_remaining, item.employee_name))
    return DashboardBirthdaysResponse(days=days, items=items)


def _ensure_can_view_employee_dashboard(
    db: Session,
    current_user: User,
    employee_id: str,
    impersonate_employee: Employee | None,
) -> None:
    """Un utente può vedere solo la dashboard del proprio dipendente collegato
    (o di quello impersonato, se admin); admin e HR possono vedere chiunque."""
    if impersonate_employee is not None:
        if impersonate_employee.id == employee_id:
            return
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non autorizzato per questo dipendente.")
    auth = build_auth_user_read(db, current_user)
    if auth.effective_role in ("admin", "hr"):
        return
    linked = get_linked_tms_employee(db, current_user)
    if linked is not None and linked.id == employee_id:
        return
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non autorizzato per questo dipendente.")


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
        select(
            Employee.id, Employee.full_name, Employee.tms_role_description,
            Assignment.area, Assignment.immobile, Assignment.cause,
            Assignment.start_time, Assignment.end_time,
        )
        .join(Assignment, Assignment.employee_id == Employee.id)
        .where(Assignment.work_date == target_date)
        .order_by(Employee.full_name, Assignment.start_time)
    ).all()

    emp_areas: dict[str, tuple[str, list[str]]] = {}
    # Una riga per allocazione, deduplicata: la stessa persona puo' comparire in
    # piu' immobili nella stessa giornata.
    area_shifts: dict[str, list[tuple[str, str, str | None, str | None]]] = {}
    seen_area_shifts: set[tuple[str, str, str | None]] = set()
    shifts_per_employee: dict[str, int] = {}
    for emp_id, emp_name, role, area, immobile, cause, start_time, end_time in present_rows:
        if emp_id not in emp_areas:
            emp_areas[emp_id] = (emp_name, [])
        area_key = CAUSE_LABELS.get(cause) or " ".join(filter(None, [area, immobile]))
        if area_key:
            emp_areas[emp_id][1].append(area_key)
        time_range = (
            f"{str(start_time)[:5]}-{str(end_time)[:5]}"
            if start_time and end_time
            else None
        )
        shift_key = (area_key or NO_AREA_LABEL, emp_id, time_range)
        if shift_key in seen_area_shifts:
            continue
        seen_area_shifts.add(shift_key)
        shifts_per_employee[emp_id] = shifts_per_employee.get(emp_id, 0) + 1
        area_shifts.setdefault(area_key or NO_AREA_LABEL, []).append(
            (emp_id, emp_name, time_range, role)
        )

    # L'orario si mostra solo a chi ha piu' di un'allocazione nella giornata:
    # per tutti gli altri sarebbe rumore, mentre qui serve a capire quando la
    # persona sta in K1 e quando in K2.
    area_people: dict[str, list[DashboardAreaPerson]] = {
        area: [
            DashboardAreaPerson(
                employee_id=emp_id,
                employee_name=emp_name,
                time_range=time_range if shifts_per_employee.get(emp_id, 0) > 1 else None,
                role=role,
            )
            for emp_id, emp_name, time_range, role in shifts
        ]
        for area, shifts in area_shifts.items()
    }

    present_detail = [
        DashboardDetail(
            employee_id=emp_id,
            employee_name=name,
            info=", ".join(sorted(set(areas))) if areas else "—",
        )
        for emp_id, (name, areas) in emp_areas.items()
    ]

    present_by_area = [
        DashboardDetail(
            employee_id=area,
            employee_name=area,
            # "info" resta l'elenco dei soli nomi: e' il testo di ripiego per i
            # client che non leggono "people".
            info=", ".join(sorted({person.employee_name for person in people})),
            people=sorted(
                people,
                key=lambda person: (person.employee_name, person.time_range or ""),
            ),
        )
        for area, people in sorted(area_people.items())
    ]

    # Employees absent today (justification covering target_date, not rejected)
    absent_rows = db.execute(
        select(
            Employee.id, Employee.full_name,
            Justification.start_date, Justification.end_date,
            Justification.start_time, Justification.end_time,
            Justification.id,
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
            info=f"{sd.strftime('%d/%m')}–{ed.strftime('%d/%m')}",
            start_time=str(st)[:5] if st else None,
            end_time=str(et)[:5] if et else None,
            justification_id=justification_id,
        )
        for emp_id, emp_name, sd, ed, st, et, justification_id in absent_rows
    ]

    # Future pending approvals (start_date >= today)
    pending_rows = db.execute(
        select(
            Employee.id, Employee.full_name,
            Justification.start_date, Justification.end_date,
            Justification.start_time, Justification.end_time,
            Justification.id,
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
            info=f"{sd.strftime('%d/%m')}–{ed.strftime('%d/%m')}",
            start_time=str(st)[:5] if st else None,
            end_time=str(et)[:5] if et else None,
            justification_id=justification_id,
        )
        for emp_id, emp_name, sd, ed, st, et, justification_id in pending_rows
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


# Cache in-memory del fetch scadenze dal TMS: il box Scadenze della home lo richiede
# a ogni apertura e i dati cambiano di rado. La chiamata TMS è identica per 30/45/60 gg
# (il filtro temporale è applicato in Python), quindi una sola cache serve tutti i range.
_EXPIRATIONS_TTL_SECONDS = 10 * 60
_expirations_cache: dict = {"at": 0.0, "data": None}
_expirations_lock = threading.Lock()


def _get_expirations_by_code(db: Session) -> dict[str, tuple[str, str, list]]:
    """Mappa CODICE TMS -> (employee_id, employee_name, records), con cache TTL."""
    now = time.monotonic()
    with _expirations_lock:
        cached = _expirations_cache["data"]
        if cached is not None and now - _expirations_cache["at"] < _EXPIRATIONS_TTL_SECONDS:
            return cached

    employees = db.scalars(
        select(Employee).where(Employee.is_active.is_(True))
    ).all()
    name_by_code: dict[str, tuple[str, str]] = {
        emp.tms_id.strip(): (emp.id, emp.full_name)
        for emp in employees
        if emp.tms_id
    }

    try:
        expirations_by_code = fetch_all_employee_expirations_from_tms(list(name_by_code.keys()))
    except Exception:
        expirations_by_code = {}

    result: dict[str, tuple[str, str, list]] = {}
    for code, (employee_id, employee_name) in name_by_code.items():
        result[code] = (employee_id, employee_name, expirations_by_code.get(code, []))

    with _expirations_lock:
        _expirations_cache["data"] = result
        _expirations_cache["at"] = now

    return result


@router.get("/expirations", response_model=DashboardExpirationsResponse)
def get_dashboard_expirations(
    days: int = Query(default=30),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> DashboardExpirationsResponse:
    """Scadenze documenti/abilitazioni dei dipendenti attivi entro `days` giorni."""
    auth = (
        build_impersonation_view(db, impersonate_employee)
        if impersonate_employee is not None
        else build_auth_user_read(db, current_user)
    )
    if not auth.can_access_expirations:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Non autorizzato.")

    if days not in (1, 7, 14, 30, 45, 60):
        days = 30

    today = date.today()
    horizon = today + timedelta(days=days)

    by_code = _get_expirations_by_code(db)
    allowed_employee_ids: set[str] | None = None
    if auth.expirations_scope == "reports":
        linked_employee = impersonate_employee or get_linked_tms_employee(db, current_user)
        if linked_employee is None:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Profilo dipendente non collegato.")
        allowed_employee_ids = collect_report_ids(db, linked_employee.id)

    items: list[DashboardExpirationItem] = []
    for employee_id, employee_name, records in by_code.values():
        if allowed_employee_ids is not None and employee_id not in allowed_employee_ids:
            continue
        for record in records:
            exp = record.expiration_date
            if exp is None or exp < today or exp > horizon:
                continue
            items.append(
                DashboardExpirationItem(
                    employee_id=employee_id,
                    employee_name=employee_name,
                    type_description=record.type_description or record.type_code,
                    document_number=record.document_number,
                    expiration_date=exp,
                    days_remaining=(exp - today).days,
                )
            )

    items.sort(key=lambda i: (i.expiration_date, i.employee_name))

    return DashboardExpirationsResponse(days=days, count=len(items), items=items)


def build_personal_info(
    db: Session,
    employee_id: str,
    target_date: date,
) -> tuple[list[PersonalAssignmentItem], list[UpcomingAbsenceItem], int]:
    """Pianificazione del giorno e assenze in corso/future per un dipendente (box "Le mie info")."""
    personal_rows = db.execute(
        select(Assignment.area, Assignment.site, Assignment.immobile, Assignment.start_time, Assignment.end_time)
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
            immobile=r.immobile,
            start_time=str(r.start_time)[:5] if r.start_time else None,
            end_time=str(r.end_time)[:5] if r.end_time else None,
        )
        for r in personal_rows
    ]

    # upcoming absences (next 60 days, including rejected)
    look_ahead = target_date + timedelta(days=60)
    upcoming_rows = db.execute(
        select(
            Justification.id,
            Justification.justification_type,
            Justification.start_date,
            Justification.end_date,
            Justification.approval_status,
            Justification.start_time,
            Justification.end_time,
        )
        .where(
            Justification.employee_id == employee_id,
            Justification.end_date >= target_date,
            Justification.start_date <= look_ahead,
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
            start_time=str(row.start_time)[:5] if row.start_time else None,
            end_time=str(row.end_time)[:5] if row.end_time else None,
        )
        for row in upcoming_rows
    ]
    pending_count = sum(
        1 for a in upcoming_absences if a.approval_status == JustificationApprovalStatus.pending.value
    )
    return today_assignments, upcoming_absences, pending_count


@router.get("/me", response_model=MyDashboardResponse)
def get_my_dashboard(
    employee_id: str = Query(),
    target_date: date = Query(alias="date"),
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> MyDashboardResponse:
    _ensure_can_view_employee_dashboard(db, current_user, employee_id, impersonate_employee)
    today_assignments, upcoming_absences, pending_count = build_personal_info(db, employee_id, target_date)

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
                Justification.approval_status,
                Justification.start_time,
                Justification.end_time,
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
                approval_status=row[5].value,
                start_time=str(row[6])[:5] if row[6] else None,
                end_time=str(row[7])[:5] if row[7] else None,
            )
            for row in absent_rows
        ]

        alloc_rows = db.execute(
            select(Employee.id, Employee.full_name, Assignment.area, Assignment.immobile)
            .join(Assignment, Assignment.employee_id == Employee.id)
            .where(
                Employee.id.in_(team_ids),
                Assignment.work_date == target_date,
            )
            .order_by(Employee.full_name)
        ).all()

        alloc_map: dict[str, list[dict]] = {}
        seen: dict[str, set] = {}
        for emp_id, emp_name, area, immobile in alloc_rows:
            key = " ".join(filter(None, [area, immobile])) or "Senza area"
            seen.setdefault(emp_id, set())
            if key not in seen[emp_id]:
                seen[emp_id].add(key)
                alloc_map.setdefault(key, []).append({"id": emp_id, "name": emp_name})

        team_allocations = [
            TeamAllocationArea(
                area=area,
                employees=sorted(emps, key=lambda e: e["name"]),
                employee_names=sorted(e["name"] for e in emps),
                count=len(emps),
            )
            for area, emps in sorted(alloc_map.items())
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
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> ApproverDashboardResponse:
    _ensure_can_view_employee_dashboard(db, current_user, employee_id, impersonate_employee)
    # Calcolato sugli approvatori attuali del dipendente, non su quelli congelati sulla
    # richiesta al momento della creazione: un cambio di approvatore deve riflettersi subito.
    approver = db.get(Employee, employee_id)
    pending_rows = list_pending_justifications_for_approver(db, approver) if approver else []

    is_approver = or_(
        Justification.approver_1_employee_id == employee_id,
        Justification.approver_2_employee_id == employee_id,
        Justification.approver_3_employee_id == employee_id,
    )
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)
    recent_rows = db.scalars(
        select(Justification)
        .options(selectinload(Justification.employee), selectinload(Justification.requested_by_employee))
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
            start_time=str(j.start_time)[:5] if j.start_time else None,
            end_time=str(j.end_time)[:5] if j.end_time else None,
            approval_status=j.approval_status.value,
            created_by_name=j.created_by_name
            or (j.requested_by_employee.full_name if j.requested_by_employee else None),
            decided_by_name=j.decided_by_name,
            decided_at=j.decided_at,
            created_at=j.created_at,
            updated_at=j.updated_at,
        )

    return ApproverDashboardResponse(
        pending_requests=[to_item(j) for j in pending_rows],
        recent_processed=[to_item(j) for j in recent_rows],
    )

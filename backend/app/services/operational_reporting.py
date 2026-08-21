from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload, selectinload

from app.models import (
    Assignment,
    Employee,
    InfinityBillingCustomerSupplierMap,
    LdapEmployee,
    OperationalArea,
    Team,
    TeamMember,
    User,
)
from app.enums import AppRole, UserRole
from app.operational_reporting_models import (
    OperationalReportAllocation,
    OperationalReportBlock,
    OperationalReportDay,
)
from app.operational_reporting_schemas import (
    ReportingAllocationInput,
    ReportingBlockInput,
    ReportingDaySave,
)
from app.services.audit import record_audit_log
from app.services.normalization import building_codes
from app.services.portal_auth import is_portal_user
from app.services.timeutils import now_local


@dataclass(frozen=True)
class ReportingAccess:
    is_admin: bool
    employee_id: str | None
    owner_employee_id: str | None


def _linked_active_employee(db: Session, current_user: User) -> Employee | None:
    return db.scalar(
        select(Employee)
        .join(LdapEmployee, LdapEmployee.tms_employee_id == Employee.id)
        .where(
            LdapEmployee.auth_user_id == current_user.id,
            LdapEmployee.is_active.is_(True),
            Employee.is_active.is_(True),
        )
    )


def require_reporting_access(db: Session, current_user: User) -> ReportingAccess:
    # L'utenza tecnica del vecchio portale Jupiter non è un amministratore del
    # nuovo processo. LDAP e dipendente vengono risolti in una sola query,
    # invece del percorso AuthUserRead che
    # ricalcola anche tutti i permessi non pertinenti a questo modulo.
    employee = _linked_active_employee(db, current_user)
    if employee is not None and (employee.app_role or "").upper() == AppRole.admin.value:
        return ReportingAccess(is_admin=True, employee_id=employee.id, owner_employee_id=None)

    if employee is not None:
        if not employee.config_can_access_timesheets:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Accesso alla rendicontazione operativa non consentito.",
            )
        return ReportingAccess(
            is_admin=False,
            employee_id=employee.id,
            owner_employee_id=employee.id,
        )

    # users.role è solo il fallback degli account privi di un dipendente
    # collegato; non può più scavalcare la configurazione del dipendente.
    if current_user.role == UserRole.admin and not is_portal_user(current_user):
        return ReportingAccess(is_admin=True, employee_id=None, owner_employee_id=None)

    raise HTTPException(
        status_code=status.HTTP_403_FORBIDDEN,
        detail="Accesso alla rendicontazione operativa non consentito.",
    )


def list_reporting_notifications(
    db: Session,
    current_user: User,
    current_time: datetime | None = None,
    target_employee: Employee | None = None,
) -> list[dict]:
    employee = target_employee or _linked_active_employee(db, current_user)
    if employee is None:
        return []

    local_now = current_time or now_local()
    if local_now.time() < time(10, 0):
        return []
    work_date = local_now.date() - timedelta(days=1)

    teams = list(
        db.scalars(
            select(Team)
            .where(
                Team.operational_reporting_owner_employee_id == employee.id,
                Team.operational_reporting_notifications_enabled.is_(True),
            )
            .options(selectinload(Team.members).joinedload(TeamMember.employee))
            .order_by(Team.name.asc())
        ).unique().all()
    )
    if not teams:
        return []

    return build_reporting_gap_notifications(db, teams, work_date)


def build_reporting_gap_notifications(
    db: Session,
    teams: list[Team],
    work_date: date,
) -> list[dict]:
    """Costruisce gli avvisi mancanti condivisi da campanella ed email."""

    active_members_by_team = {
        team.id: {
            membership.employee_id: membership.employee.full_name
            for membership in team.members
            if membership.employee.is_active
        }
        for team in teams
    }
    active_employee_ids = {
        employee_id
        for members in active_members_by_team.values()
        for employee_id in members
    }
    planned_employee_ids = set(
        db.scalars(
            select(Assignment.employee_id).where(
                Assignment.work_date == work_date,
                Assignment.employee_id.in_(active_employee_ids or {""}),
            )
        ).all()
    )
    # Una giornata confermata vale come completata solo se copre tutto il tempo
    # pianificato: confermarne metà la faceva sparire da campanella ed email
    # senza che nulla segnalasse le ore rimaste da attribuire.
    completed_by_team: dict[str, set[str]] = {}
    uncovered_by_team: dict[str, dict[str, int]] = {}
    for report in db.scalars(
        select(OperationalReportDay)
        .where(
            OperationalReportDay.work_date == work_date,
            OperationalReportDay.team_id.in_({team.id for team in teams}),
            OperationalReportDay.status == "CONFIRMED",
        )
        .options(
            selectinload(OperationalReportDay.blocks).selectinload(OperationalReportBlock.allocations)
        )
    ).all():
        metrics = _dashboard_report_metrics(report)
        uncovered = max(0, metrics["planned"] - metrics["allocated"])
        if uncovered:
            uncovered_by_team.setdefault(report.team_id, {})[report.employee_id] = uncovered
        else:
            completed_by_team.setdefault(report.team_id, set()).add(report.employee_id)

    notifications = []
    for team in teams:
        members = active_members_by_team[team.id]
        expected_ids = set(members) & planned_employee_ids
        missing_ids = expected_ids - completed_by_team.get(team.id, set())
        if not missing_ids:
            continue
        uncovered_minutes = uncovered_by_team.get(team.id, {})
        missing = sorted(
            ((employee_id, members[employee_id]) for employee_id in missing_ids),
            key=lambda item: item[1].casefold(),
        )
        partial_ids = [employee_id for employee_id, _ in missing if employee_id in uncovered_minutes]
        count = len(missing)
        notifications.append({
            "id": f"operational-reporting:{work_date.isoformat()}:{team.id}",
            "title": f"Rendicontazione da completare · {team.name}",
            "message": _reporting_gap_message(work_date, count, len(partial_ids)),
            "work_date": work_date,
            "team_id": team.id,
            "team_name": team.name,
            "missing_count": count,
            "missing_employee_ids": [item[0] for item in missing],
            "missing_employee_names": [item[1] for item in missing],
            # L'email elenca le persone: sulle parziali dice anche quanto manca,
            # altrimenti l'owner non sa distinguerle da chi non ha aperto nulla.
            "missing_employee_labels": [
                f"{name} ({_minutes_label(uncovered_minutes[employee_id])} da attribuire)"
                if employee_id in uncovered_minutes
                else name
                for employee_id, name in missing
            ],
            "partial_count": len(partial_ids),
            "partial_employee_ids": partial_ids,
        })
    return notifications


def _minutes_label(minutes: int) -> str:
    hours, rest = divmod(max(0, minutes), 60)
    if hours and rest:
        return f"{hours}h {rest:02d}m"
    return f"{hours}h" if hours else f"{rest}m"


def _reporting_gap_message(work_date: date, missing_count: int, partial_count: int) -> str:
    to_confirm = missing_count - partial_count
    parts = []
    if to_confirm:
        parts.append(
            f"manca la conferma di {to_confirm} "
            f"{'persona pianificata' if to_confirm == 1 else 'persone pianificate'}"
        )
    if partial_count:
        parts.append(
            f"{partial_count} "
            + (
                "rendicontazione confermata non copre"
                if partial_count == 1
                else "rendicontazioni confermate non coprono"
            )
            + " tutto il tempo pianificato"
        )
    return f"Per il {work_date.strftime('%d/%m/%Y')} " + " e ".join(parts) + "."


def _accessible_teams(db: Session, access: ReportingAccess, work_date: date | None = None) -> list[Team]:
    stmt = (
        select(Team)
        .options(joinedload(Team.members).joinedload(TeamMember.employee))
        .order_by(Team.name.asc())
    )
    if not access.is_admin:
        stmt = stmt.where(Team.operational_reporting_owner_employee_id == access.owner_employee_id)
    if work_date is not None:
        planned_team_ids = (
            select(TeamMember.team_id)
            .join(Assignment, Assignment.employee_id == TeamMember.employee_id)
            .where(Assignment.work_date == work_date)
        )
        reported_team_ids = select(OperationalReportDay.team_id).where(
            OperationalReportDay.work_date == work_date
        )
        stmt = stmt.where(or_(Team.id.in_(planned_team_ids), Team.id.in_(reported_team_ids)))
    return list(db.scalars(stmt).unique().all())


def _load_report(db: Session, report_id: str) -> OperationalReportDay | None:
    return db.scalar(
        select(OperationalReportDay)
        .where(OperationalReportDay.id == report_id)
        .options(
            selectinload(OperationalReportDay.blocks).selectinload(OperationalReportBlock.allocations)
        )
    )


def _assert_report_access(db: Session, access: ReportingAccess, report: OperationalReportDay) -> None:
    if access.is_admin:
        return
    allowed = db.scalar(
        select(Team.id).where(
            Team.id == report.team_id,
            Team.operational_reporting_owner_employee_id == access.owner_employee_id,
        )
    )
    if allowed is None:
        raise HTTPException(status_code=403, detail="Rendicontazione non accessibile.")


def _minutes_between(start: time, end: time) -> int:
    start_minutes = start.hour * 60 + start.minute
    end_minutes = end.hour * 60 + end.minute
    if end_minutes <= start_minutes:
        raise HTTPException(status_code=422, detail="L'orario di fine deve essere successivo all'inizio.")
    return end_minutes - start_minutes


def _pause_minutes(pauses: list[dict], start: time, end: time) -> int:
    normalized: list[tuple[int, int]] = []
    day_start = start.hour * 60 + start.minute
    day_end = end.hour * 60 + end.minute
    for pause in pauses:
        pause_start = time.fromisoformat(str(pause["start"]))
        pause_end = time.fromisoformat(str(pause["end"]))
        p_start = pause_start.hour * 60 + pause_start.minute
        p_end = pause_end.hour * 60 + pause_end.minute
        if p_end <= p_start or p_start < day_start or p_end > day_end:
            raise HTTPException(status_code=422, detail="Le pause devono essere intervalli validi compresi nella giornata.")
        normalized.append((p_start, p_end))
    normalized.sort()
    for previous, current in zip(normalized, normalized[1:]):
        if current[0] < previous[1]:
            raise HTTPException(status_code=422, detail="Le pause non possono sovrapporsi.")
    return sum(item_end - item_start for item_start, item_end in normalized)


def _block_capacity(start: time, end: time, break_minutes: int) -> int:
    return max(0, _minutes_between(start, end) - break_minutes)


def _time_as_minutes(value: time) -> int:
    return value.hour * 60 + value.minute


def _minutes_as_time(value: int) -> time:
    return time(hour=value // 60, minute=value % 60)


def _parse_clock(value: object) -> int | None:
    """Minuti da mezzanotte per "HH:MM" e "HH:MM:SS"; ``None`` se non leggibile."""
    parts = str(value or "").strip().split(":")
    if len(parts) < 2:
        return None
    try:
        hours, minutes = int(parts[0]), int(parts[1])
    except ValueError:
        return None
    if not (0 <= hours < 24 and 0 <= minutes < 60):
        return None
    return hours * 60 + minutes


def _merge_windows(windows: list[tuple[int, int]]) -> list[tuple[int, int]]:
    merged: list[tuple[int, int]] = []
    for start, end in sorted(windows):
        if end <= start:
            continue
        if merged and start <= merged[-1][1]:
            merged[-1] = (merged[-1][0], max(merged[-1][1], end))
        else:
            merged.append((start, end))
    return merged


def _pause_windows(pauses: list[dict]) -> list[tuple[int, int]]:
    """Intervalli di pausa normalizzati, tolleranti verso dati storici imperfetti."""
    windows: list[tuple[int, int]] = []
    for pause in pauses:
        start = _parse_clock(pause.get("start"))
        end = _parse_clock(pause.get("end"))
        if start is not None and end is not None:
            windows.append((start, end))
    return _merge_windows(windows)


def _overlap_minutes(windows: list[tuple[int, int]], start: int, end: int) -> int:
    return sum(max(0, min(end, item_end) - max(start, item_start)) for item_start, item_end in windows)


def _reporting_windows(
    planned: list[tuple[int, int]], actual_start: int, actual_end: int, pause_windows: list[tuple[int, int]]
) -> list[tuple[int, int, int]]:
    """Estende solo la rendicontazione, senza alterare lo snapshot Planner."""
    result: list[tuple[int, int, int]] = []
    for index, (planned_start, planned_end) in enumerate(planned):
        start = actual_start if index == 0 else planned_start
        end = actual_end if index == len(planned) - 1 else planned_end
        gross = max(0, end - start)
        result.append((start, end, max(0, gross - _overlap_minutes(pause_windows, start, end))))
    return result


def _reporting_block_windows(
    blocks: list[OperationalReportBlock], actual_start: time, actual_end: time, pauses: list[dict]
) -> dict[str, tuple[time, time, int]]:
    ordered = sorted(blocks, key=lambda item: item.sequence)
    if not ordered:
        return {}
    windows = _reporting_windows(
        [(_time_as_minutes(item.planned_start), _time_as_minutes(item.planned_end)) for item in ordered],
        _time_as_minutes(actual_start),
        _time_as_minutes(actual_end),
        _pause_windows(pauses),
    )
    return {
        block.id: (_minutes_as_time(start), _minutes_as_time(end), capacity)
        for block, (start, end, capacity) in zip(ordered, windows)
    }


def _schedule_break_window(employee: Employee, work_date: date) -> tuple[int, int] | None:
    """Pausa implicita dell'orario di default, con la stessa regola del Planner."""
    schedule = employee.default_schedule or []
    index = work_date.weekday()
    if not isinstance(schedule, list) or index >= len(schedule):
        return None
    day = schedule[index]
    if not isinstance(day, dict) or not day.get("enabled"):
        return None
    shift_start = _parse_clock(day.get("start"))
    shift_end = _parse_clock(day.get("end"))
    if shift_start is None or shift_end is None:
        return None
    break_start = _parse_clock(day.get("break_start"))
    break_end = _parse_clock(day.get("break_end"))
    if break_start is not None and break_end is not None and break_end > break_start:
        return (break_start, break_end)
    try:
        break_minutes = int(day.get("break_minutes") or 0)
    except (TypeError, ValueError):
        return None
    net = shift_end - shift_start - break_minutes
    if break_minutes <= 0 or net <= 0:
        return None
    # Il Planner centra la pausa implicita a metà del tempo netto.
    centered_start = shift_start + round(net / 2)
    return (centered_start, centered_start + break_minutes)


def _assignment_break_window(
    assignment: Assignment, schedule_break: tuple[int, int] | None
) -> tuple[int, int] | None:
    start = _time_as_minutes(assignment.start_time)
    end = _time_as_minutes(assignment.end_time)
    if assignment.break_start is not None and assignment.break_end is not None:
        break_start = _time_as_minutes(assignment.break_start)
        break_end = _time_as_minutes(assignment.break_end)
        if start < break_start < break_end < end:
            return (break_start, break_end)
    if schedule_break is not None and start <= schedule_break[0] and schedule_break[1] <= end:
        return schedule_break
    return None


def _area_for_assignment(db: Session, area_value: str | None) -> OperationalArea | None:
    normalized = (area_value or "").strip()
    if not normalized:
        return None
    return db.scalar(
        select(OperationalArea).where(
            OperationalArea.is_active.is_(True),
            or_(
                func.lower(OperationalArea.name) == normalized.lower(),
                func.lower(OperationalArea.area_code) == normalized.lower(),
            ),
        )
    )


def _validate_location(db: Session, area_id: str, building: str | None) -> tuple[OperationalArea, str | None]:
    area = db.get(OperationalArea, area_id)
    if area is None or not area.is_active:
        raise HTTPException(status_code=422, detail="Area effettiva non valida.")
    normalized_building = (building or "").strip().upper() or None
    allowed = building_codes(area.buildings, visibility="visible_in_reporting")
    if normalized_building is not None and normalized_building not in allowed:
        raise HTTPException(status_code=422, detail=f"Immobile non valido per l'area {area.name}.")
    return area, normalized_building


def _allocation_location(
    block: OperationalReportBlock, allocation: OperationalReportAllocation
) -> tuple[str | None, str | None, str | None]:
    """Posizione effettiva di una singola attività.

    Le rendicontazioni salvate prima dell'Area per attività hanno i campi a
    ``NULL`` e continuano a valere per l'intero blocco: il fallback è quindi
    tutto-o-niente, altrimenti un box senza immobile erediterebbe quello del
    blocco pur essendo in un'altra area.
    """
    if allocation.actual_area_id:
        return (
            allocation.actual_area_id,
            allocation.actual_area_name_snapshot,
            allocation.actual_building,
        )
    return (block.actual_area_id, block.actual_area_name_snapshot, block.actual_building)


def _mapping_buildings(mapping: InfinityBillingCustomerSupplierMap) -> list[str]:
    return building_codes(mapping.buildings)


def _eligible_customers(db: Session, area_id: str | None, building: str | None) -> dict[str, dict]:
    if not area_id:
        return {}
    mappings = db.scalars(
        select(InfinityBillingCustomerSupplierMap).where(
            InfinityBillingCustomerSupplierMap.is_active.is_(True),
            InfinityBillingCustomerSupplierMap.operational_area_id == area_id,
        )
    ).all()
    building_key = (building or "").strip().upper() or None
    result: dict[str, dict] = {}
    for mapping in mappings:
        specific_buildings = _mapping_buildings(mapping)
        if building_key:
            if specific_buildings and building_key not in specific_buildings:
                continue
        elif specific_buildings:
            continue
        code = mapping.customer_supplier_code.strip()
        item = result.setdefault(
            code,
            {
                "code": code,
                "description": mapping.customer_supplier_description,
                "mapping_ids": [],
                "jupiter_descriptions": [],
                "_jupiter_by_description": {},
            },
        )
        item["mapping_ids"].append(mapping.id)
        jupiter_description = (mapping.jupiter_description or "").strip()
        if jupiter_description:
            jupiter_item = item["_jupiter_by_description"].setdefault(
                jupiter_description,
                {"description": jupiter_description, "mapping_ids": []},
            )
            jupiter_item["mapping_ids"].append(mapping.id)
    for item in result.values():
        item["jupiter_descriptions"] = sorted(
            item.pop("_jupiter_by_description").values(),
            key=lambda value: value["description"].casefold(),
        )
    return result


def _assignment_snapshot(assignment: Assignment) -> dict:
    cause = assignment.cause.value if hasattr(assignment.cause, "value") else str(assignment.cause)
    return {
        "assignment_id": assignment.id,
        "start_time": assignment.start_time.isoformat(timespec="minutes"),
        "end_time": assignment.end_time.isoformat(timespec="minutes"),
        "break_start": assignment.break_start.isoformat(timespec="minutes") if assignment.break_start else None,
        "break_end": assignment.break_end.isoformat(timespec="minutes") if assignment.break_end else None,
        "cause": cause,
        "area": assignment.area,
        "immobile": assignment.immobile,
        "customer": assignment.customer,
        "activity": assignment.activity,
        "notes": assignment.notes,
    }


def _planner_pause_windows(
    employee: Employee, work_date: date, assignments: list[Assignment]
) -> list[tuple[int, int]]:
    """Le pause che il Planner disegna sui blocchi: esplicite sull'assegnazione
    oppure ereditate dall'orario di default del dipendente."""
    schedule_break = _schedule_break_window(employee, work_date)
    return _merge_windows(
        [
            window
            for assignment in assignments
            if (window := _assignment_break_window(assignment, schedule_break)) is not None
        ]
    )


def _pauses_payload(windows: list[tuple[int, int]]) -> list[dict]:
    return [
        {
            "start": _minutes_as_time(start).isoformat(timespec="minutes"),
            "end": _minutes_as_time(end).isoformat(timespec="minutes"),
        }
        for start, end in windows
    ]


def _serialize_block(
    block: OperationalReportBlock,
    reporting_window: tuple[time, time, int] | None = None,
) -> dict:
    reporting_start, reporting_end, capacity = reporting_window or (
        block.planned_start,
        block.planned_end,
        _block_capacity(block.planned_start, block.planned_end, block.planned_break_minutes),
    )
    allocations = []
    for allocation in sorted(block.allocations, key=lambda item: item.sequence):
        area_id, area_name, building = _allocation_location(block, allocation)
        allocations.append({
            "id": allocation.id,
            "customer_code": allocation.customer_code,
            "customer_description": allocation.customer_description_snapshot,
            "jupiter_description": allocation.jupiter_description_snapshot,
            "actual_area_id": area_id,
            "actual_area_name": area_name,
            "actual_building": building,
            "sequence": allocation.sequence,
            "start_offset_minutes": allocation.start_offset_minutes,
            "minutes": allocation.minutes,
            "notes": allocation.notes,
            "eligible_mapping_ids": allocation.eligible_mapping_ids or [],
            "created_by_name": allocation.created_by_name,
            "created_at": allocation.created_at,
            "last_modified_by_name": allocation.last_modified_by_name,
            "last_modified_at": allocation.last_modified_at,
        })
    return {
        "id": block.id,
        "source_assignment_id": block.source_assignment_id,
        "sequence": block.sequence,
        "planned_start": block.planned_start,
        "planned_end": block.planned_end,
        "planned_break_minutes": block.planned_break_minutes,
        "reporting_start": reporting_start,
        "reporting_end": reporting_end,
        "capacity_minutes": capacity,
        "planned_area": block.planned_area,
        "planned_building": block.planned_building,
        "actual_area_id": block.actual_area_id,
        "actual_area_name": block.actual_area_name_snapshot,
        "actual_building": block.actual_building,
        "notes": block.notes,
        # I clienti sono caricati in modo lazy quando l'utente espande la riga.
        # Evita di duplicare l'intera anagrafica Incroci per ogni blocco.
        "eligible_customers": [],
        "allocations": allocations,
        "allocated_minutes": sum(item["minutes"] for item in allocations),
    }


def _serialize_report_member(report: OperationalReportDay) -> dict:
    pauses = report.pauses or []
    windows = _reporting_block_windows(report.blocks, report.actual_start, report.actual_end, pauses)
    blocks = [_serialize_block(block, windows.get(block.id)) for block in report.blocks]
    # In lettura le pause si limitano a scalare il tempo netto: una giornata
    # storica incoerente non deve far fallire l'intera griglia.
    day_start = _time_as_minutes(report.actual_start)
    day_end = _time_as_minutes(report.actual_end)
    work_minutes = max(
        0, day_end - day_start - _overlap_minutes(_pause_windows(pauses), day_start, day_end)
    )
    allocated = sum(block["allocated_minutes"] for block in blocks)
    return {
        "employee_id": report.employee_id,
        "employee_name": report.employee_name_snapshot,
        "report_id": report.id,
        "has_planning": True,
        "status": report.status,
        "planned_start": report.planned_start,
        "planned_end": report.planned_end,
        "actual_start": report.actual_start,
        "actual_end": report.actual_end,
        "pauses": pauses,
        "notes": report.notes,
        "work_minutes": work_minutes,
        "allocated_minutes": allocated,
        "uncovered_minutes": max(0, work_minutes - allocated),
        "confirmed_at": report.confirmed_at,
        "updated_at": report.updated_at,
        "blocks": blocks,
    }


def _serialize_virtual_member(
    employee: Employee,
    work_date: date,
    assignments: list[Assignment],
    area_by_key: dict[str, OperationalArea],
) -> dict:
    if not assignments:
        return {"employee_id": employee.id, "employee_name": employee.full_name, "has_planning": False, "blocks": []}
    assignments.sort(key=lambda item: item.start_time)
    pause_windows = _planner_pause_windows(employee, work_date, assignments)
    pauses = _pauses_payload(pause_windows)
    actual_start, actual_end = assignments[0].start_time, max(item.end_time for item in assignments)
    windows = _reporting_windows(
        [(_time_as_minutes(item.start_time), _time_as_minutes(item.end_time)) for item in assignments],
        _time_as_minutes(actual_start),
        _time_as_minutes(actual_end),
        pause_windows,
    )
    blocks = []
    for sequence, (assignment, (start, end, capacity)) in enumerate(zip(assignments, windows)):
        area = area_by_key.get((assignment.area or "").strip().casefold())
        area_id = area.id if area else None
        building = (assignment.immobile or "").strip().upper() or None
        blocks.append(
            {
                "source_assignment_id": assignment.id,
                "sequence": sequence,
                "planned_start": assignment.start_time,
                "planned_end": assignment.end_time,
                "planned_break_minutes": _overlap_minutes(
                    pause_windows, _time_as_minutes(assignment.start_time), _time_as_minutes(assignment.end_time)
                ),
                "reporting_start": _minutes_as_time(start),
                "reporting_end": _minutes_as_time(end),
                "capacity_minutes": capacity,
                "planned_area": assignment.area,
                "planned_building": assignment.immobile,
                "actual_area_id": area_id,
                "actual_area_name": area.name if area else assignment.area,
                "actual_building": building,
                "eligible_customers": [],
                "allocations": [],
                "allocated_minutes": 0,
            }
        )
    day_start, day_end = _time_as_minutes(actual_start), _time_as_minutes(actual_end)
    work_minutes = max(0, day_end - day_start - _overlap_minutes(pause_windows, day_start, day_end))
    return {
        "employee_id": employee.id,
        "employee_name": employee.full_name,
        "has_planning": True,
        "status": None,
        "planned_start": actual_start,
        "planned_end": actual_end,
        "actual_start": actual_start,
        "actual_end": actual_end,
        "pauses": pauses,
        "work_minutes": work_minutes,
        "allocated_minutes": 0,
        "uncovered_minutes": work_minutes,
        "blocks": blocks,
    }


def build_day_context(db: Session, current_user: User, work_date: date) -> dict:
    access = require_reporting_access(db, current_user)
    teams = _accessible_teams(db, access, work_date)
    employee_ids = {member.employee_id for team in teams for member in team.members if member.employee.is_active}
    assignments = db.scalars(
        select(Assignment)
        .where(Assignment.work_date == work_date, Assignment.employee_id.in_(employee_ids or {""}))
        .order_by(Assignment.start_time.asc())
    ).all()
    assignments_by_employee: dict[str, list[Assignment]] = {}
    for assignment in assignments:
        assignments_by_employee.setdefault(assignment.employee_id, []).append(assignment)

    team_ids = {team.id for team in teams}
    reports = db.scalars(
        select(OperationalReportDay)
        .where(OperationalReportDay.work_date == work_date, OperationalReportDay.team_id.in_(team_ids or {""}))
        .options(joinedload(OperationalReportDay.blocks).joinedload(OperationalReportBlock.allocations))
    ).unique().all()
    reports_by_employee = {report.employee_id: report for report in reports}
    reports_by_team: dict[str, list[OperationalReportDay]] = {}
    for report in reports:
        reports_by_team.setdefault(report.team_id, []).append(report)

    area_rows = db.scalars(
        select(OperationalArea).where(OperationalArea.is_active.is_(True)).order_by(OperationalArea.name.asc())
    ).all()
    areas = [
        {
            "id": area.id,
            "code": area.area_code,
            "name": area.name,
            "buildings": building_codes(area.buildings, visibility="visible_in_reporting"),
        }
        for area in area_rows
    ]
    area_by_key: dict[str, OperationalArea] = {}
    for area in area_rows:
        area_by_key[area.name.strip().casefold()] = area
        area_by_key[area.area_code.strip().casefold()] = area
    team_payload = []
    for team in teams:
        members = []
        current_member_ids: set[str] = set()
        for membership in sorted(team.members, key=lambda item: item.employee.full_name.casefold()):
            employee = membership.employee
            if not employee.is_active:
                continue
            current_member_ids.add(employee.id)
            report = reports_by_employee.get(employee.id)
            if report is not None and report.team_id != team.id:
                continue
            members.append(
                _serialize_report_member(report)
                if report
                else _serialize_virtual_member(
                    employee, work_date, assignments_by_employee.get(employee.id, []), area_by_key
                )
            )
        for historical_report in reports_by_team.get(team.id, []):
            if historical_report.employee_id not in current_member_ids:
                members.append(_serialize_report_member(historical_report))
        members.sort(key=lambda item: item["employee_name"].casefold())
        if any(member["has_planning"] for member in members):
            team_payload.append(
                {"team_id": team.id, "team_name": team.name, "team_icon": team.icon, "team_color": team.color, "members": members}
            )
    return {"work_date": work_date, "areas": areas, "teams": team_payload}


def _dashboard_report_metrics(report: OperationalReportDay) -> dict[str, int]:
    start = _time_as_minutes(report.actual_start)
    end = _time_as_minutes(report.actual_end)
    work = max(0, end - start - _overlap_minutes(_pause_windows(report.pauses or []), start, end))
    allocated = sum(allocation.minutes for block in report.blocks for allocation in block.allocations)
    planned = sum(
        _block_capacity(block.planned_start, block.planned_end, block.planned_break_minutes)
        for block in report.blocks
    )
    return {
        "work": work,
        "allocated": allocated,
        "uncovered": max(0, work - allocated),
        "overtime": max(0, work - 480),
        "planned": planned,
    }


def _dashboard_assignment_minutes(assignments: list[Assignment], employee: Employee, work_date: date) -> int:
    """Minuti netti attesi dal Planner per una risorsa e una giornata."""
    schedule_break = _schedule_break_window(employee, work_date)
    total = 0
    for assignment in assignments:
        start = _time_as_minutes(assignment.start_time)
        end = _time_as_minutes(assignment.end_time)
        break_window = _assignment_break_window(assignment, schedule_break)
        break_minutes = _overlap_minutes([break_window] if break_window else [], start, end)
        total += max(0, end - start - break_minutes)
    return total


def build_dashboard(
    db: Session,
    current_user: User,
    start_date: date,
    end_date: date,
    team_id: str | None = None,
    employee_id: str | None = None,
    customer_code: str | None = None,
    jupiter_description: str | None = None,
    area_id: str | None = None,
    building: str | None = None,
) -> dict:
    if end_date < start_date:
        raise HTTPException(status_code=422, detail="La data finale deve essere successiva a quella iniziale.")
    if (end_date - start_date).days > 366:
        raise HTTPException(status_code=422, detail="Il periodo massimo della dashboard è di 367 giorni.")

    access = require_reporting_access(db, current_user)
    accessible_teams = _accessible_teams(db, access)
    if team_id is not None:
        selected = next((team for team in accessible_teams if team.id == team_id), None)
        if selected is None:
            raise HTTPException(status_code=403, detail="Squadra non accessibile.")
        teams = [selected]
    else:
        teams = accessible_teams

    team_by_id = {team.id: team for team in teams}
    employee_by_id: dict[str, Employee] = {}
    employee_team_id: dict[str, str] = {}
    for team in teams:
        for membership in team.members:
            if membership.employee.is_active:
                employee_by_id[membership.employee_id] = membership.employee
                employee_team_id[membership.employee_id] = team.id
    employee_ids = set(employee_by_id)
    if employee_id is not None:
        if employee_id not in employee_ids:
            raise HTTPException(status_code=403, detail="Dipendente non accessibile.")
        employee_ids = {employee_id}
    team_ids = set(team_by_id)

    assignments = list(db.scalars(
        select(Assignment).where(
            Assignment.work_date >= start_date,
            Assignment.work_date <= end_date,
            Assignment.employee_id.in_(employee_ids or {""}),
        )
    ).all())
    assignments_by_key: dict[tuple[str, date], list[Assignment]] = {}
    for assignment in assignments:
        assignments_by_key.setdefault((assignment.employee_id, assignment.work_date), []).append(assignment)

    all_reports = list(db.scalars(
        select(OperationalReportDay)
        .where(
            OperationalReportDay.work_date >= start_date,
            OperationalReportDay.work_date <= end_date,
            OperationalReportDay.team_id.in_(team_ids or {""}),
        )
        .options(selectinload(OperationalReportDay.blocks).selectinload(OperationalReportBlock.allocations))
    ).unique().all())
    if employee_id is not None:
        all_reports = [report for report in all_reports if report.employee_id == employee_id]

    normalized_building = (building or "").strip().upper() or None
    has_allocation_filters = bool(customer_code or jupiter_description or area_id or normalized_building)

    def matches_allocation(block: OperationalReportBlock, allocation: OperationalReportAllocation) -> bool:
        if customer_code and allocation.customer_code != customer_code:
            return False
        if jupiter_description and allocation.jupiter_description_snapshot != jupiter_description:
            return False
        # I filtri di luogo seguono il box, non più il blocco: una giornata
        # con uno spostamento deve comparire sotto entrambe le aree.
        allocation_area_id, _, allocation_building = _allocation_location(block, allocation)
        if area_id and allocation_area_id != area_id:
            return False
        if normalized_building and (allocation_building or "").strip().upper() != normalized_building:
            return False
        return True

    matched_allocations: dict[str, list[tuple[OperationalReportBlock, OperationalReportAllocation]]] = {}
    reports = []
    for report in all_reports:
        matches = [
            (block, allocation)
            for block in report.blocks
            for allocation in block.allocations
            if matches_allocation(block, allocation)
        ]
        if has_allocation_filters and not matches:
            continue
        matched_allocations[report.id] = matches
        reports.append(report)
    reports_by_key = {(report.employee_id, report.work_date): report for report in reports}

    expected_keys = set(reports_by_key) if has_allocation_filters else set(assignments_by_key) | set(reports_by_key)
    team_expected: dict[str, set[tuple[str, date]]] = {item_id: set() for item_id in team_ids}
    for key in expected_keys:
        report = reports_by_key.get(key)
        key_team_id = report.team_id if report is not None else employee_team_id.get(key[0])
        if key_team_id in team_expected:
            team_expected[key_team_id].add(key)

    trend_by_date: dict[date, dict] = {}
    cursor = start_date
    while cursor <= end_date:
        trend_by_date[cursor] = {
            "work_date": cursor,
            "planned_days": 0,
            "reports": 0,
            "confirmed": 0,
            "work_minutes": 0,
            "allocated_minutes": 0,
            "uncovered_minutes": 0,
        }
        cursor += timedelta(days=1)
    for _, work_date in expected_keys:
        trend_by_date[work_date]["planned_days"] += 1

    metrics_by_report: dict[str, dict[str, int]] = {}
    customer_groups: dict[tuple[str, str, str | None], dict] = {}
    location_groups: dict[tuple[str | None, str, str | None], dict] = {}
    for report in reports:
        metrics = _dashboard_report_metrics(report)
        if has_allocation_filters:
            metrics["allocated"] = sum(allocation.minutes for _, allocation in matched_allocations[report.id])
            metrics["uncovered"] = max(0, metrics["work"] - metrics["allocated"])
        metrics_by_report[report.id] = metrics
        trend = trend_by_date[report.work_date]
        trend["reports"] += 1
        trend["confirmed"] += int(report.status == "CONFIRMED")
        trend["work_minutes"] += metrics["work"]
        trend["allocated_minutes"] += metrics["allocated"]
        trend["uncovered_minutes"] += metrics["uncovered"]
        for block, allocation in matched_allocations[report.id]:
            allocation_area_id, allocation_area_name, allocation_building = _allocation_location(block, allocation)
            location_key = (
                allocation_area_id,
                allocation_area_name or block.planned_area or "Area non specificata",
                allocation_building or None,
            )
            location = location_groups.setdefault(location_key, {
                "area_id": location_key[0],
                "area_name": location_key[1],
                "building": location_key[2],
                "minutes": 0,
                "allocations": 0,
                "employee_ids": set(),
            })
            customer_key = (
                allocation.customer_code,
                allocation.customer_description_snapshot,
                allocation.jupiter_description_snapshot,
            )
            customer = customer_groups.setdefault(customer_key, {
                "customer_code": customer_key[0],
                "customer_description": customer_key[1],
                "jupiter_description": customer_key[2],
                "minutes": 0,
                "allocations": 0,
                "employee_ids": set(),
            })
            customer["minutes"] += allocation.minutes
            customer["allocations"] += 1
            customer["employee_ids"].add(report.employee_id)
            location["minutes"] += allocation.minutes
            location["allocations"] += 1
            location["employee_ids"].add(report.employee_id)

    # Il percorso Planner -> rendicontazione resta volutamente indipendente dai
    # filtri sulle allocazioni: una giornata non iniziata non ha ancora un
    # cliente/area effettivi con cui possa essere filtrata. La UI lo nasconde
    # quando tali filtri sono attivi, evitando confronti tra perimetri diversi.
    workflow_reports_by_key = {(report.employee_id, report.work_date): report for report in all_reports}
    workflow_keys = set(assignments_by_key) | set(workflow_reports_by_key)
    workflow_rows = []
    for employee_key, work_date in workflow_keys:
        report = workflow_reports_by_key.get((employee_key, work_date))
        employee = employee_by_id.get(employee_key)
        if employee is None:
            continue
        day_assignments = assignments_by_key.get((employee_key, work_date), [])
        if day_assignments:
            planned_minutes = _dashboard_assignment_minutes(day_assignments, employee, work_date)
        elif report is not None:
            planned_minutes = _dashboard_report_metrics(report)["planned"]
        else:
            planned_minutes = 0
        metrics = _dashboard_report_metrics(report) if report is not None else {
            "work": 0, "allocated": 0, "uncovered": 0,
        }
        status = report.status if report is not None else "NOT_STARTED"
        team = team_by_id.get(report.team_id if report is not None else employee_team_id.get(employee_key))
        workflow_rows.append({
            "employee_id": employee_key,
            "employee_name": employee.full_name,
            "team_id": team.id if team is not None else None,
            "team_name": team.name if team is not None else (report.team_name_snapshot if report is not None else "Senza squadra"),
            "work_date": work_date,
            "status": status,
            "planned_minutes": planned_minutes,
            "work_minutes": metrics["work"],
            "allocated_minutes": metrics["allocated"],
            "uncovered_minutes": metrics["uncovered"],
            "variance_minutes": metrics["work"] - planned_minutes if report is not None else 0,
        })
    workflow_rows.sort(key=lambda row: (row["work_date"], row["employee_name"].casefold()))
    saved_workflow_rows = [row for row in workflow_rows if row["status"] != "NOT_STARTED"]
    workflow = {
        "expected_minutes": sum(row["planned_minutes"] for row in workflow_rows),
        "not_started_planned_minutes": sum(
            row["planned_minutes"] for row in workflow_rows if row["status"] == "NOT_STARTED"
        ),
        "saved_planned_minutes": sum(row["planned_minutes"] for row in saved_workflow_rows),
        "draft_planned_minutes": sum(
            row["planned_minutes"] for row in workflow_rows if row["status"] != "CONFIRMED" and row["status"] != "NOT_STARTED"
        ),
        "confirmed_planned_minutes": sum(
            row["planned_minutes"] for row in workflow_rows if row["status"] == "CONFIRMED"
        ),
        "saved_work_minutes": sum(row["work_minutes"] for row in saved_workflow_rows),
        "allocated_minutes": sum(row["allocated_minutes"] for row in saved_workflow_rows),
        "uncovered_minutes": sum(row["uncovered_minutes"] for row in saved_workflow_rows),
        "variance_minutes": sum(row["variance_minutes"] for row in saved_workflow_rows),
        "rows": workflow_rows,
    }

    def summarized(values: list[OperationalReportDay], keys: set[tuple[str, date]]) -> dict:
        work = sum(metrics_by_report[item.id]["work"] for item in values)
        planned = sum(metrics_by_report[item.id]["planned"] for item in values)
        allocated = sum(metrics_by_report[item.id]["allocated"] for item in values)
        confirmed = sum(item.status == "CONFIRMED" for item in values)
        return {
            "planned_days": len(keys),
            "reports": len(values),
            "not_started": max(0, len(keys) - len(values)),
            "draft": sum(item.status != "CONFIRMED" for item in values),
            "confirmed": confirmed,
            "planned_minutes": planned,
            "work_minutes": work,
            "variance_minutes": work - planned,
            "allocated_minutes": allocated,
            "uncovered_minutes": sum(metrics_by_report[item.id]["uncovered"] for item in values),
            "overtime_minutes": sum(metrics_by_report[item.id]["overtime"] for item in values),
            "coverage_percent": round((allocated / work) * 100, 1) if work else 0,
            "confirmation_percent": round((confirmed / len(keys)) * 100, 1) if keys else 0,
        }

    summary = summarized(reports, expected_keys)
    reports_by_team: dict[str, list[OperationalReportDay]] = {item_id: [] for item_id in team_ids}
    for report in reports:
        reports_by_team.setdefault(report.team_id, []).append(report)
    team_rows = []
    for team in teams:
        team_keys = team_expected.get(team.id, set())
        team_reports = reports_by_team.get(team.id, [])
        team_summary = summarized(team_reports, team_keys)
        if team_id is None and team_summary["planned_days"] == 0:
            continue
        members = []
        for employee_id in {key[0] for key in team_keys}:
            member_keys = {key for key in team_keys if key[0] == employee_id}
            member_reports = [report for report in team_reports if report.employee_id == employee_id]
            member_summary = summarized(member_reports, member_keys)
            employee = employee_by_id.get(employee_id)
            historical_report = max(member_reports, key=lambda report: report.work_date, default=None)
            employee_name = employee.full_name if employee is not None else historical_report.employee_name_snapshot
            members.append({
                "employee_id": employee_id,
                "employee_name": employee_name,
                **{
                    key: value
                    for key, value in member_summary.items()
                    if key not in {"planned_minutes", "variance_minutes", "overtime_minutes", "confirmation_percent"}
                },
            })
        members.sort(key=lambda row: row["employee_name"].casefold())
        team_rows.append({
            "team_id": team.id,
            "team_name": team.name,
            "team_icon": team.icon,
            "team_color": team.color,
            **{
                key: value
                for key, value in team_summary.items()
                if key not in {"planned_minutes", "variance_minutes", "overtime_minutes", "confirmation_percent"}
            },
            "members": members,
        })
    team_rows.sort(key=lambda row: (-row["uncovered_minutes"], row["team_name"].casefold()))

    customers = []
    for item in customer_groups.values():
        employee_ids_for_item = item.pop("employee_ids")
        customers.append({**item, "employees": len(employee_ids_for_item)})
    customers.sort(key=lambda row: (-row["minutes"], row["customer_description"].casefold()))
    locations = []
    for item in location_groups.values():
        employee_ids_for_item = item.pop("employee_ids")
        locations.append({**item, "employees": len(employee_ids_for_item)})
    locations.sort(key=lambda row: (-row["minutes"], row["area_name"].casefold(), row["building"] or ""))

    return {
        "start_date": start_date,
        "end_date": end_date,
        "selected_team_id": team_id,
        "filters": {
            "employee_id": employee_id,
            "customer_code": customer_code,
            "jupiter_description": jupiter_description,
            "area_id": area_id,
            "building": normalized_building,
        },
        "summary": summary,
        "workflow": workflow,
        "available_teams": [
            {
                "team_id": team.id,
                "team_name": team.name,
                "team_icon": team.icon,
                "team_color": team.color,
            }
            for team in accessible_teams
        ],
        "teams": team_rows,
        "trend": list(trend_by_date.values()),
        "customers": customers,
        "locations": locations,
    }


def list_eligible_customers(
    db: Session, current_user: User, area_id: str, building: str | None
) -> list[dict]:
    require_reporting_access(db, current_user)
    _validate_location(db, area_id, building)
    customers = _eligible_customers(db, area_id, building)
    return sorted(customers.values(), key=lambda item: item["description"].casefold())


def _target_team_and_assignments(
    db: Session, access: ReportingAccess, employee_id: str, work_date: date
) -> tuple[Team, Employee, list[Assignment]]:
    teams = _accessible_teams(db, access, work_date)
    team = next((item for item in teams if any(member.employee_id == employee_id for member in item.members)), None)
    if team is None:
        raise HTTPException(status_code=403, detail="Dipendente non accessibile.")
    employee = db.get(Employee, employee_id)
    assignments = list(
        db.scalars(
            select(Assignment)
            .where(Assignment.employee_id == employee_id, Assignment.work_date == work_date)
            .order_by(Assignment.start_time.asc())
        ).all()
    )
    if employee is None or not assignments:
        raise HTTPException(status_code=422, detail="Il dipendente non ha pianificazione per questa giornata.")
    return team, employee, assignments


def _create_report(
    db: Session, current_user: User, team: Team, employee: Employee, assignments: list[Assignment], payload: ReportingDaySave
) -> OperationalReportDay:
    planned_start = min(item.start_time for item in assignments)
    planned_end = max(item.end_time for item in assignments)
    report = OperationalReportDay(
        employee_id=employee.id,
        work_date=payload.work_date,
        team_id=team.id,
        employee_name_snapshot=employee.full_name,
        team_name_snapshot=team.name,
        planned_start=planned_start,
        planned_end=planned_end,
        actual_start=payload.actual_start,
        actual_end=payload.actual_end,
        pauses=[item.model_dump(mode="json") for item in payload.pauses],
        planner_snapshot=[_assignment_snapshot(item) for item in assignments],
        status="DRAFT",
        notes=payload.notes,
        last_modified_by_user_id=current_user.id,
    )
    db.add(report)
    db.flush()
    # Lo snapshot conserva le pause come le mostra il Planner, non quelle che
    # l'utente sta rendicontando: restano il termine di paragone del "pianificato".
    planned_pauses = _planner_pause_windows(employee, payload.work_date, assignments)
    for sequence, assignment in enumerate(assignments):
        area = _area_for_assignment(db, assignment.area)
        report.blocks.append(
            OperationalReportBlock(
                source_assignment_id=assignment.id,
                sequence=sequence,
                planned_start=assignment.start_time,
                planned_end=assignment.end_time,
                planned_break_minutes=_overlap_minutes(
                    planned_pauses, _time_as_minutes(assignment.start_time), _time_as_minutes(assignment.end_time)
                ),
                planned_area=assignment.area,
                planned_building=assignment.immobile,
                actual_area_id=area.id if area else None,
                actual_area_name_snapshot=area.name if area else assignment.area,
                actual_building=(assignment.immobile or "").strip().upper() or None,
            )
        )
    db.flush()
    return report


def _apply_block_input(
    db: Session,
    block: OperationalReportBlock,
    payload: ReportingBlockInput,
    capacity: int,
    actor_name: str,
    now: datetime,
) -> None:
    area, building = _validate_location(db, payload.actual_area_id, payload.actual_building)
    # La posizione del blocco resta lo snapshot della destinazione pianificata e
    # fa da default; ogni attività può però indicarne una propria, perché la
    # stessa fascia può essere lavorata in aree diverse da chi si sposta.
    previous_block_location = (block.actual_area_id, block.actual_building)
    location_cache: dict[tuple[str, str | None], tuple[OperationalArea, str | None, dict[str, dict]]] = {}

    def location_for(allocation_input: ReportingAllocationInput) -> tuple[OperationalArea, str | None, dict[str, dict]]:
        if allocation_input.actual_area_id:
            key = (allocation_input.actual_area_id, (allocation_input.actual_building or "").strip().upper() or None)
        else:
            key = (area.id, building)
        cached = location_cache.get(key)
        if cached is None:
            allocation_area, allocation_building = _validate_location(db, key[0], key[1])
            cached = (
                allocation_area,
                allocation_building,
                _eligible_customers(db, allocation_area.id, allocation_building),
            )
            location_cache[key] = cached
        return cached

    existing_by_id = {item.id: item for item in block.allocations}
    unmatched_by_key: dict[tuple[str, str | None], list[OperationalReportAllocation]] = {}
    for item in block.allocations:
        unmatched_by_key.setdefault((item.customer_code, item.jupiter_description_snapshot), []).append(item)
    matched_ids: set[str] = set()
    total = 0
    legacy_cursor = 0
    occupied_ranges: list[tuple[int, int]] = []
    desired_allocations: list[OperationalReportAllocation] = []
    for sequence, allocation_input in enumerate(payload.allocations):
        code = allocation_input.customer_code.strip()
        jupiter_description = (allocation_input.jupiter_description or "").strip() or None
        allocation_key = (code, jupiter_description)
        total += allocation_input.minutes
        start_offset = allocation_input.start_offset_minutes
        if start_offset is None:
            start_offset = legacy_cursor
        end_offset = start_offset + allocation_input.minutes
        legacy_cursor = max(legacy_cursor, end_offset)
        occupied_ranges.append((start_offset, end_offset))
        allocation_area, allocation_building, eligible = location_for(allocation_input)
        customer = eligible.get(code)
        old = existing_by_id.get(allocation_input.id) if allocation_input.id else None
        if allocation_input.id and old is None:
            raise HTTPException(status_code=422, detail="Blocco attività non valido.")
        if old is None:
            candidates = [item for item in unmatched_by_key.get(allocation_key, []) if item.id not in matched_ids]
            old = candidates[0] if candidates else None
        if old is not None:
            matched_ids.add(old.id)
        old_location = None if old is None else (
            (old.actual_area_id, old.actual_building) if old.actual_area_id else previous_block_location
        )
        location_unchanged = old_location == (allocation_area.id, allocation_building)
        if customer is None and (old is None or not location_unchanged):
            location_label = f"{allocation_area.name}{f' / {allocation_building}' if allocation_building else ''}"
            raise HTTPException(
                status_code=422,
                detail=f"Il cliente {code} non è valido per {location_label}.",
            )
        jupiter_options = {
            item["description"]: item
            for item in (customer or {}).get("jupiter_descriptions", [])
        }
        jupiter_option = jupiter_options.get(jupiter_description) if jupiter_description else None
        if jupiter_option is None and (old is None or not location_unchanged):
            raise HTTPException(
                status_code=422,
                detail=f"Seleziona una Descrizione Jupiter valida per il cliente {code}.",
            )
        if old is None:
            # Le validazioni sopra garantiscono entrambe le opzioni per una
            # nuova allocazione. Tenerle esplicite evita fallback su ``old``.
            assert customer is not None
            assert jupiter_option is not None
            allocation = OperationalReportAllocation(
                customer_code=code,
                customer_description_snapshot=customer["description"],
                jupiter_description_snapshot=jupiter_description,
                actual_area_id=allocation_area.id,
                actual_area_name_snapshot=allocation_area.name,
                actual_building=allocation_building,
                minutes=allocation_input.minutes,
                start_offset_minutes=start_offset,
                notes=allocation_input.notes,
                eligible_mapping_ids=jupiter_option["mapping_ids"],
                sequence=sequence,
                created_by_name=actor_name,
                created_at=now,
                last_modified_by_name=actor_name,
                last_modified_at=now,
            )
        else:
            allocation = old
            # Il salvataggio riscrive l'intera giornata: senza confronto ogni
            # casella risulterebbe "modificata" a ogni autosalvataggio e la
            # data perderebbe significato.
            updated = {
                "customer_description_snapshot": (customer or {"description": old.customer_description_snapshot})["description"],
                "actual_area_id": allocation_area.id,
                "actual_area_name_snapshot": allocation_area.name,
                "actual_building": allocation_building,
                "minutes": allocation_input.minutes,
                "start_offset_minutes": start_offset,
                "notes": allocation_input.notes,
                "eligible_mapping_ids": (
                    jupiter_option["mapping_ids"] if jupiter_option is not None else old.eligible_mapping_ids
                ),
                "sequence": sequence,
            }
            changed = [key for key, value in updated.items() if getattr(allocation, key) != value]
            for key in changed:
                setattr(allocation, key, updated[key])
            if changed:
                allocation.last_modified_by_name = actor_name
                allocation.last_modified_at = now
        desired_allocations.append(allocation)
    if total > capacity:
        raise HTTPException(status_code=422, detail="I minuti attribuiti superano la capienza del blocco.")
    if any(end > capacity for _, end in occupied_ranges):
        raise HTTPException(status_code=422, detail="Un blocco rendicontato supera la fascia disponibile.")
    ordered_ranges = sorted(occupied_ranges)
    if any(current[0] < previous[1] for previous, current in zip(ordered_ranges, ordered_ranges[1:])):
        raise HTTPException(status_code=422, detail="I blocchi rendicontati non possono sovrapporsi.")
    block.actual_area_id = area.id
    block.actual_area_name_snapshot = area.name
    block.actual_building = building
    block.notes = payload.notes
    desired_ids = {item.id for item in desired_allocations if item.id}
    for stale in list(block.allocations):
        if stale.id not in desired_ids:
            block.allocations.remove(stale)
    for allocation in desired_allocations:
        if allocation not in block.allocations:
            block.allocations.append(allocation)


def _audit_snapshot(report: OperationalReportDay) -> dict:
    return {
        "status": report.status,
        "actual_start": report.actual_start.isoformat(timespec="minutes"),
        "actual_end": report.actual_end.isoformat(timespec="minutes"),
        "pauses": report.pauses or [],
        "notes": report.notes,
        "blocks": [
            {
                "id": block.id,
                "source_assignment_id": block.source_assignment_id,
                "actual_area_id": block.actual_area_id,
                "actual_building": block.actual_building,
                "notes": block.notes,
                "allocations": [
                    {
                        "customer_code": item.customer_code,
                        "jupiter_description": item.jupiter_description_snapshot,
                        "actual_area_id": item.actual_area_id,
                        "actual_building": item.actual_building,
                        "sequence": item.sequence,
                        "start_offset_minutes": item.start_offset_minutes,
                        "minutes": item.minutes,
                        "notes": item.notes,
                    }
                    for item in sorted(block.allocations, key=lambda allocation: allocation.sequence)
                ],
            }
            for block in report.blocks
        ],
    }


def save_day(db: Session, current_user: User, payload: ReportingDaySave) -> dict:
    access = require_reporting_access(db, current_user)
    report = db.scalar(
        select(OperationalReportDay)
        .where(OperationalReportDay.employee_id == payload.employee_id, OperationalReportDay.work_date == payload.work_date)
        .options(selectinload(OperationalReportDay.blocks).selectinload(OperationalReportBlock.allocations))
    )
    created = report is None
    if report is None:
        team, employee, assignments = _target_team_and_assignments(db, access, payload.employee_id, payload.work_date)
        report = _create_report(db, current_user, team, employee, assignments, payload)
    else:
        _assert_report_access(db, access, report)
    previous_snapshot = None if created else _audit_snapshot(report)

    pauses = [item.model_dump(mode="json") for item in payload.pauses]
    work_minutes = _minutes_between(payload.actual_start, payload.actual_end) - _pause_minutes(
        pauses, payload.actual_start, payload.actual_end
    )
    if work_minutes <= 0:
        raise HTTPException(status_code=422, detail="La giornata deve contenere tempo lavorato.")

    actor_name = current_user.display_name or current_user.username
    now = datetime.now(timezone.utc)
    blocks_by_id = {block.id: block for block in report.blocks}
    blocks_by_source = {block.source_assignment_id: block for block in report.blocks if block.source_assignment_id}
    if len(payload.blocks) != len(report.blocks):
        raise HTTPException(status_code=422, detail="La rendicontazione deve conservare tutti i blocchi pianificati.")
    touched: set[str] = set()
    reporting_windows = _reporting_block_windows(report.blocks, payload.actual_start, payload.actual_end, pauses)
    for block_input in payload.blocks:
        block = blocks_by_id.get(block_input.id) if block_input.id else blocks_by_source.get(block_input.source_assignment_id)
        if block is None or block.id in touched:
            raise HTTPException(status_code=422, detail="Blocco di pianificazione non valido o duplicato.")
        touched.add(block.id)
        _, _, capacity = reporting_windows[block.id]
        _apply_block_input(
            db,
            block,
            block_input,
            capacity,
            actor_name,
            now,
        )

    allocated = sum(allocation.minutes for block in report.blocks for allocation in block.allocations)
    if allocated > work_minutes:
        raise HTTPException(status_code=422, detail="I minuti attribuiti superano il tempo netto della giornata.")

    report.actual_start = payload.actual_start
    report.actual_end = payload.actual_end
    report.pauses = pauses
    report.notes = payload.notes
    report.last_modified_by_user_id = current_user.id
    record_audit_log(
        db,
        action="create" if created else "update",
        entity="operational_report_day",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "report_id": report.id,
            "employee_id": report.employee_id,
            "work_date": report.work_date.isoformat(),
            "status": report.status,
            "work_minutes": work_minutes,
            "allocated_minutes": allocated,
            "before": previous_snapshot,
            "after": _audit_snapshot(report),
        },
    )
    db.commit()
    refreshed = _load_report(db, report.id)
    return _serialize_report_member(refreshed)


def reset_day(db: Session, current_user: User, work_date: date) -> dict:
    access = require_reporting_access(db, current_user)
    teams = _accessible_teams(db, access, work_date)
    team_ids = {team.id for team in teams}
    reports = db.scalars(
        select(OperationalReportDay)
        .where(
            OperationalReportDay.work_date == work_date,
            OperationalReportDay.team_id.in_(team_ids or {""}),
        )
        .options(selectinload(OperationalReportDay.blocks).selectinload(OperationalReportBlock.allocations))
    ).all()
    for report in reports:
        _assert_report_access(db, access, report)
        record_audit_log(
            db,
            action="reset_from_planner",
            entity="operational_report_day",
            actor_name=current_user.username,
            user_id=current_user.id,
            detail={
                "report_id": report.id,
                "employee_id": report.employee_id,
                "work_date": work_date.isoformat(),
                "before": _audit_snapshot(report),
            },
        )
        db.delete(report)
    if reports:
        db.commit()
    return build_day_context(db, current_user, work_date)


def reset_member(db: Session, current_user: User, employee_id: str, work_date: date) -> dict:
    access = require_reporting_access(db, current_user)
    report = db.scalar(
        select(OperationalReportDay)
        .where(OperationalReportDay.employee_id == employee_id, OperationalReportDay.work_date == work_date)
        .options(selectinload(OperationalReportDay.blocks).selectinload(OperationalReportBlock.allocations))
    )
    if report is not None:
        _assert_report_access(db, access, report)
        record_audit_log(
            db,
            action="restore_from_planner",
            entity="operational_report_day",
            actor_name=current_user.username,
            user_id=current_user.id,
            detail={
                "report_id": report.id,
                "employee_id": report.employee_id,
                "work_date": work_date.isoformat(),
                "before": _audit_snapshot(report),
            },
        )
        db.delete(report)
        db.commit()

    context = build_day_context(db, current_user, work_date)
    member = next(
        (
            member
            for team in context["teams"]
            for member in team["members"]
            if member["employee_id"] == employee_id
        ),
        None,
    )
    if member is None:
        raise HTTPException(status_code=404, detail="Dipendente non trovato nella pianificazione della giornata.")
    return member


def confirm_day(db: Session, current_user: User, report_id: str) -> dict:
    access = require_reporting_access(db, current_user)
    report = _load_report(db, report_id)
    if report is None:
        raise HTTPException(status_code=404, detail="Rendicontazione non trovata.")
    _assert_report_access(db, access, report)
    previous_status = report.status
    report.status = "CONFIRMED"
    report.confirmed_at = datetime.now(timezone.utc)
    report.confirmed_by_user_id = current_user.id
    report.last_modified_by_user_id = current_user.id
    record_audit_log(
        db,
        action="confirm",
        entity="operational_report_day",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "report_id": report.id,
            "employee_id": report.employee_id,
            "work_date": report.work_date.isoformat(),
            "previous_status": previous_status,
            "new_status": report.status,
        },
    )
    db.commit()
    return _serialize_report_member(_load_report(db, report.id))

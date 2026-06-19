from __future__ import annotations

import csv
import io
import json
import threading
from datetime import date, datetime, time, timedelta, timezone
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import SessionLocal
from app.models import Employee, LocalProject, OperationalArea, TimesheetDay, TimesheetMapping, TimesheetSlot, TimesheetSyncRun, TimesheetWorker, User
from app.services.audit import record_audit_log

SOURCE_STATUS_VALUES = ["COMPILED", "CONFIRMED", "APPROVED", "UNKNOWN"]
APPROVAL_STATUS_VALUES = ["PENDING", "APPROVED", "CORRECTION_REQUESTED"]
MAPPING_TYPES = {"worker", "project", "cost_center"}

_scheduler_thread: threading.Thread | None = None
_scheduler_stop = threading.Event()
_scheduler_lock = threading.Lock()


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _clean_text(value) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _parse_bool(value, default: bool = True) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    normalized = str(value).strip().lower()
    if normalized in {"1", "true", "yes", "y", "si", "s", "active", "enabled"}:
        return True
    if normalized in {"0", "false", "no", "n", "inactive", "disabled"}:
        return False
    return default


def _parse_int(value, default: int = 0) -> int:
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return int(value)
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(round(value))
    text = str(value).strip()
    if not text:
        return default
    if ":" in text:
        parts = text.split(":")
        if len(parts) >= 2 and parts[0].isdigit() and parts[1].isdigit():
            return int(parts[0]) * 60 + int(parts[1])
    try:
        return int(float(text.replace(",", ".")))
    except ValueError:
        return default


def _parse_date(value) -> date | None:
    if value is None or value == "":
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    for fmt in (None, "%Y-%m-%d", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            if fmt is None:
                return datetime.fromisoformat(text).date()
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def _parse_time(value) -> time | None:
    if value is None or value == "":
        return None
    if isinstance(value, time):
        return value.replace(microsecond=0)
    if isinstance(value, datetime):
        return value.time().replace(microsecond=0)
    text = str(value).strip()
    if not text:
        return None
    if text.endswith("Z"):
        text = text[:-1] + "+00:00"
    for fmt in (None, "%H:%M", "%H:%M:%S"):
        try:
            if fmt is None and "T" in text:
                return datetime.fromisoformat(text).time().replace(microsecond=0)
            if fmt is None:
                continue
            return datetime.strptime(text, fmt).time().replace(microsecond=0)
        except ValueError:
            continue
    return None


def _first(mapping: dict, *keys, default=None):
    for key in keys:
        if key in mapping and mapping[key] not in (None, ""):
            return mapping[key]
    return default


def _extract_list(payload, hints: tuple[str, ...]) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in hints + ("data", "items", "results", "rows", "records"):
            candidate = payload.get(key)
            if isinstance(candidate, list):
                return [item for item in candidate if isinstance(item, dict)]
            if isinstance(candidate, dict):
                nested = _extract_list(candidate, hints)
                if nested:
                    return nested
    return []


def _normalize_source_status(value) -> str:
    normalized = str(value or "").strip().lower()
    if normalized in {"approved", "approvato", "ok"}:
        return "APPROVED"
    if normalized in {"confirmed", "confermato", "confermata", "sent", "submitted"}:
        return "CONFIRMED"
    if normalized in {"compiled", "filled", "draft", "saved", "compilato"}:
        return "COMPILED"
    return "UNKNOWN"


def _normalize_mapping_type(value: str) -> str:
    normalized = str(value or "").strip().lower()
    if normalized not in MAPPING_TYPES:
        raise ValueError("Tipo mapping non valido.")
    return normalized


def _normalize_external_reference(value: str | None) -> str | None:
    cleaned = _clean_text(value)
    return cleaned.lower() if cleaned else None


def _minutes_between(start_time: time | None, end_time: time | None, break_minutes: int = 0) -> int:
    if start_time is None or end_time is None:
        return 0
    start_dt = datetime.combine(date.today(), start_time)
    end_dt = datetime.combine(date.today(), end_time)
    if end_dt < start_dt:
        end_dt += timedelta(days=1)
    minutes = int((end_dt - start_dt).total_seconds() // 60) - max(break_minutes, 0)
    return max(minutes, 0)


def _hours_from_minutes(minutes: int) -> float:
    return round(minutes / 60, 2)


def _slot_sources(record: dict) -> list[dict]:
    for key in ("slots", "time_slots", "segments", "entries", "fasce", "details"):
        value = record.get(key)
        if isinstance(value, list):
            return [item for item in value if isinstance(item, dict)]
    return []


def _normalize_user_record(record: dict) -> dict | None:
    external_id = _clean_text(_first(record, "external_id", "userId", "user_id", "worker_id", "employee_id", "operator_id", "id", "code"))
    if not external_id:
        return None
    return {
        "external_id": external_id,
        "external_code": _clean_text(_first(record, "code", "user_code", "employee_code", "badge_code")),
        "full_name": _clean_text(_first(record, "full_name", "nome", "name", "employee_name", "worker_name", "operator_name", "display_name")) or external_id,
        "department": _clean_text(_first(record, "department", "reparto", "team", "department_name")),
        "company": _clean_text(_first(record, "company", "societa", "company_name")),
        "role_name": _clean_text(_first(record, "role", "ruolo", "role_name", "job_title")),
        "is_active": _parse_bool(_first(record, "is_active", "attivo", "active", "enabled", default=True), True),
        "raw_payload": record,
    }


def _normalize_slot_record(record: dict, sequence: int) -> dict:
    start_time = _parse_time(_first(record, "start_time", "start", "from", "in", "ora_inizio"))
    end_time = _parse_time(_first(record, "end_time", "end", "to", "out", "ora_fine"))
    break_minutes = _parse_int(_first(record, "break_minutes", "pause_minutes", "break", "pausa"), 0)
    minutes = _parse_int(_first(record, "minutes", "duration_minutes", "worked_minutes"), 0)
    if minutes <= 0:
        minutes = _minutes_between(start_time, end_time, break_minutes)
    return {
        "external_slot_id": _clean_text(_first(record, "external_slot_id", "fasciaId", "slot_id", "entry_id", "id")),
        "sequence": sequence,
        "start_time": start_time,
        "end_time": end_time,
        "break_minutes": break_minutes,
        "minutes": minutes,
        "project_code": _clean_text(_first(record, "project_code", "aws_commessa_id", "project", "commessa", "job_code", "order_code")),
        "project_description": _clean_text(_first(record, "project_description", "project_name", "commessa_descrizione", "job_name")),
        "cost_center_code": _clean_text(_first(record, "cost_center_code", "codice_cdc", "cost_center", "centro_costo")),
        "cost_center_description": _clean_text(_first(record, "cost_center_description", "cost_center_name", "centro_costo_descrizione")),
        "notes": _clean_text(_first(record, "notes", "descrizione_libera", "note", "description")),
        "source_payload": record,
    }


def _normalize_timesheet_record(record: dict) -> dict | None:
    work_date = _parse_date(_first(record, "work_date", "data", "date", "day", "workday"))
    worker_external_id = _clean_text(_first(record, "worker_external_id", "userId", "user_id", "worker_id", "employee_id", "operator_id", "user_code", "employee_code"))
    if work_date is None or not worker_external_id:
        return None

    slot_sources = _slot_sources(record)
    slots = []
    if slot_sources:
        for index, slot_source in enumerate(slot_sources, start=1):
            slots.append(_normalize_slot_record(slot_source, index))
    else:
        slots.append(_normalize_slot_record(record, 1))

    check_in = _parse_time(_first(record, "check_in", "oraEntrata", "clock_in", "start_time", "in", "ora_entrata"))
    check_out = _parse_time(_first(record, "check_out", "oraUscita", "clock_out", "end_time", "out", "ora_uscita"))
    break_minutes = _parse_int(_first(record, "break_minutes", "pausa", "pause_minutes", "break"), 0)
    total_minutes = _parse_int(_first(record, "total_minutes", "worked_minutes", "minutes"), 0)

    if not check_in:
        check_candidates = [slot["start_time"] for slot in slots if slot["start_time"] is not None]
        if check_candidates:
            check_in = min(check_candidates)
    if not check_out:
        checkout_candidates = [slot["end_time"] for slot in slots if slot["end_time"] is not None]
        if checkout_candidates:
            check_out = max(checkout_candidates)
    if break_minutes <= 0:
        break_minutes = sum(slot["break_minutes"] for slot in slots)
    if total_minutes <= 0:
        total_minutes = sum(slot["minutes"] for slot in slots)

    return {
        "external_day_id": _clean_text(_first(record, "external_day_id", "giornataId", "timesheet_id", "day_id", "id")),
        "worker_external_id": worker_external_id,
        "worker_name": _clean_text(_first(record, "worker_name", "employee_name", "operator_name", "full_name")) or worker_external_id,
        "department": _clean_text(_first(record, "department", "reparto")),
        "company": _clean_text(_first(record, "company", "societa")),
        "role_name": _clean_text(_first(record, "role", "ruolo", "role_name")),
        "work_date": work_date,
        "status": _normalize_source_status(_first(record, "status", "stato", "state", "timesheet_status")),
        "check_in": check_in,
        "check_out": check_out,
        "break_minutes": break_minutes,
        "total_minutes": total_minutes,
        "supervisor_note": _clean_text(_first(record, "supervisor_note", "manager_note", "notes", "note_responsabile")),
        "source_payload": record,
        "slots": slots,
    }


def _mapping_lookup(db: Session) -> dict[str, dict[str, TimesheetMapping]]:
    mappings = db.scalars(select(TimesheetMapping).where(TimesheetMapping.is_active.is_(True))).all()
    lookup = {mapping_type: {} for mapping_type in MAPPING_TYPES}
    for mapping in mappings:
        mapping_type = str(mapping.mapping_type).lower()
        normalized_key = _normalize_external_reference(mapping.external_key)
        if mapping_type in lookup and normalized_key:
            lookup[mapping_type][normalized_key] = mapping
    return lookup


def _anomaly_reasons(worker: TimesheetWorker, day_data: dict, mapping_lookup: dict[str, dict[str, TimesheetMapping]]) -> list[str]:
    reasons: list[str] = []
    slots = day_data.get("slots", [])
    if worker.tms_employee_id is None:
        reasons.append("Operatore non mappato")
    if not slots:
        reasons.append("Nessuna fascia oraria")
    if day_data.get("check_in") is None:
        reasons.append("Ora entrata mancante")
    if day_data.get("check_out") is None:
        reasons.append("Ora uscita mancante")
    if int(day_data.get("total_minutes") or 0) <= 0:
        reasons.append("Ore totali non valide")

    seen_projects = set()
    seen_cost_centers = set()
    for slot in slots:
        project_code = _clean_text(slot.get("project_code"))
        project_key = _normalize_external_reference(project_code)
        cost_center_code = _clean_text(slot.get("cost_center_code"))
        cost_center_key = _normalize_external_reference(cost_center_code)
        if project_key and project_key not in mapping_lookup["project"] and project_code not in seen_projects:
            seen_projects.add(project_code)
            reasons.append(f"Commessa non mappata: {project_code}")
        if cost_center_key and cost_center_key not in mapping_lookup["cost_center"] and cost_center_code not in seen_cost_centers:
            seen_cost_centers.add(cost_center_code)
            reasons.append(f"Centro di costo non mappato: {cost_center_code}")
    return reasons


def _replace_slots(day: TimesheetDay, slots_data: list[dict]) -> None:
    day.slots.clear()
    for slot_data in slots_data:
        day.slots.append(TimesheetSlot(**slot_data))


def _worker_employee_codes(worker: TimesheetWorker) -> list[str]:
    candidates: list[str] = []
    for raw_value in (worker.external_code, worker.external_id):
        value = _clean_text(raw_value)
        if value and value not in candidates:
            candidates.append(value)
    return candidates


def _worker_display_name(worker: TimesheetWorker) -> str:
    if worker.tms_employee and worker.tms_employee.full_name:
        return worker.tms_employee.full_name
    return worker.full_name


def _worker_display_code(worker: TimesheetWorker) -> str | None:
    if worker.tms_employee and worker.tms_employee.tms_id:
        return worker.tms_employee.tms_id
    return None


def _worker_display_department(worker: TimesheetWorker) -> str | None:
    if worker.tms_employee and worker.tms_employee.organization_department:
        return worker.tms_employee.organization_department
    return worker.department


def _worker_display_company(worker: TimesheetWorker) -> str | None:
    if worker.tms_employee and worker.tms_employee.datore_lavoro:
        return worker.tms_employee.datore_lavoro
    return worker.company


def _worker_display_role(worker: TimesheetWorker) -> str | None:
    if worker.tms_employee and worker.tms_employee.tms_role_description:
        return worker.tms_employee.tms_role_description
    return worker.role_name


def _link_worker_to_matching_employee(db: Session, worker: TimesheetWorker) -> bool:
    if worker.tms_employee_id is not None:
        return False

    candidate_codes = _worker_employee_codes(worker)
    if not candidate_codes:
        return False

    employee = db.scalar(select(Employee).where(Employee.tms_id.in_(candidate_codes)).order_by(Employee.is_active.desc(), Employee.full_name.asc()))
    if employee is None:
        return False

    existing_link = db.scalar(
        select(TimesheetWorker).where(
            TimesheetWorker.tms_employee_id == employee.id,
            TimesheetWorker.id != worker.id,
        )
    )
    if existing_link is not None:
        return False

    worker.tms_employee_id = employee.id
    return True


def auto_link_timesheet_workers_by_matricola(db: Session) -> int:
    linked = 0
    workers = db.scalars(select(TimesheetWorker).where(TimesheetWorker.tms_employee_id.is_(None))).all()
    for worker in workers:
        if _link_worker_to_matching_employee(db, worker):
            _recompute_worker_day_anomalies(db, worker)
            linked += 1
    return linked


def _ensure_worker(db: Session, record: dict) -> TimesheetWorker:
    worker = db.scalars(select(TimesheetWorker).where(TimesheetWorker.external_id == record["worker_external_id"])).first()
    if worker is None:
        worker = TimesheetWorker(
            external_id=record["worker_external_id"],
            full_name=record.get("worker_name") or record["worker_external_id"],
            department=record.get("department"),
            company=record.get("company"),
            role_name=record.get("role_name"),
            is_active=True,
            last_synced_at=utcnow(),
            raw_payload={},
        )
        db.add(worker)
        db.flush()
        _link_worker_to_matching_employee(db, worker)
    return worker


def _recompute_worker_day_anomalies(db: Session, worker: TimesheetWorker) -> None:
    mapping_lookup = _mapping_lookup(db)
    days = list(
        db.scalars(
            select(TimesheetDay)
            .where(TimesheetDay.worker_id == worker.id)
            .options(selectinload(TimesheetDay.slots))
            .order_by(TimesheetDay.work_date.desc())
        ).all()
    )
    for day in days:
        anomaly_payload = {
            "check_in": day.check_in,
            "check_out": day.check_out,
            "total_minutes": day.total_minutes,
            "slots": [{"project_code": slot.project_code, "cost_center_code": slot.cost_center_code} for slot in day.slots],
        }
        reasons = _anomaly_reasons(worker, anomaly_payload, mapping_lookup)
        day.anomaly_reasons = reasons
        day.anomaly_count = len(reasons)
        day.has_anomalies = bool(reasons)


def _recompute_days_for_mapping_change(db: Session, mapping_type: str, external_key: str) -> None:
    normalized_mapping_type = _normalize_mapping_type(mapping_type)
    normalized_external_key = _normalize_external_reference(external_key)
    if not normalized_external_key:
        return

    slot_field = TimesheetSlot.project_code if normalized_mapping_type == "project" else TimesheetSlot.cost_center_code
    days = list(
        db.scalars(
            select(TimesheetDay)
            .join(TimesheetSlot, TimesheetSlot.day_id == TimesheetDay.id)
            .where(func.lower(func.trim(slot_field)) == normalized_external_key)
            .options(
                selectinload(TimesheetDay.worker).selectinload(TimesheetWorker.tms_employee),
                selectinload(TimesheetDay.slots),
            )
            .distinct()
        ).all()
    )
    mapping_lookup = _mapping_lookup(db)
    for day in days:
        anomaly_payload = {
            "check_in": day.check_in,
            "check_out": day.check_out,
            "total_minutes": day.total_minutes,
            "slots": [{"project_code": slot.project_code, "cost_center_code": slot.cost_center_code} for slot in day.slots],
        }
        reasons = _anomaly_reasons(day.worker, anomaly_payload, mapping_lookup)
        day.anomaly_reasons = reasons
        day.anomaly_count = len(reasons)
        day.has_anomalies = bool(reasons)


def _serialize_slot(slot: TimesheetSlot) -> dict:
    return {
        "id": slot.id,
        "start_time": slot.start_time,
        "end_time": slot.end_time,
        "break_minutes": slot.break_minutes,
        "project_code": slot.project_code,
        "project_description": slot.project_description,
        "cost_center_code": slot.cost_center_code,
        "cost_center_description": slot.cost_center_description,
        "notes": slot.notes,
        "sequence": slot.sequence,
        "minutes": slot.minutes,
    }


def _allocation_key(slot: TimesheetSlot) -> tuple[str | None, str | None, str | None, str | None]:
    return (slot.project_code, slot.project_description, slot.cost_center_code, slot.cost_center_description)


def _project_lookup_by_external_key(db: Session) -> dict[str, LocalProject]:
    mappings = db.scalars(
        select(TimesheetMapping).where(
            TimesheetMapping.mapping_type == "project",
            TimesheetMapping.is_active.is_(True),
        )
    ).all()
    projects_by_id = {project.id: project for project in db.scalars(select(LocalProject)).all()}
    lookup: dict[str, LocalProject] = {}
    for mapping in mappings:
        normalized_key = _normalize_external_reference(mapping.external_key)
        if normalized_key and mapping.internal_key and mapping.internal_key in projects_by_id:
            lookup[normalized_key] = projects_by_id[mapping.internal_key]
    return lookup


def _cost_center_lookup_by_external_key(db: Session) -> dict[str, OperationalArea]:
    mappings = db.scalars(
        select(TimesheetMapping).where(
            TimesheetMapping.mapping_type == "cost_center",
            TimesheetMapping.is_active.is_(True),
        )
    ).all()
    areas_by_code = {area.area_code: area for area in db.scalars(select(OperationalArea)).all()}
    lookup: dict[str, OperationalArea] = {}
    for mapping in mappings:
        normalized_key = _normalize_external_reference(mapping.external_key)
        if normalized_key and mapping.internal_key and mapping.internal_key in areas_by_code:
            lookup[normalized_key] = areas_by_code[mapping.internal_key]
    return lookup


def _project_reference(project_lookup: dict[str, LocalProject], project_code: str | None, project_description: str | None) -> tuple[str | None, str | None, str | None]:
    project_key = _normalize_external_reference(project_code)
    if project_key and project_key in project_lookup:
        project = project_lookup[project_key]
        display = project.name or project.project_code
        return project.project_code, project.name or project.project_code, display
    display = project_description or project_code
    return project_code, project_description or project_code, display


def _cost_center_reference(area_lookup: dict[str, OperationalArea], cost_center_code: str | None, cost_center_description: str | None) -> tuple[str | None, str | None, str | None]:
    area_key = _normalize_external_reference(cost_center_code)
    if area_key and area_key in area_lookup:
        area = area_lookup[area_key]
        display = f"{area.area_code} - {area.name}" if area.name else area.area_code
        return area.area_code, area.name or area.area_code, display
    display = cost_center_description or cost_center_code
    return cost_center_code, cost_center_description or cost_center_code, display


def _build_allocations(days: list[TimesheetDay], project_lookup: dict[str, LocalProject], area_lookup: dict[str, OperationalArea]) -> list[dict]:
    totals: dict[tuple[str | None, str | None, str | None, str | None], int] = {}
    for day in days:
        for slot in day.slots:
            key = _allocation_key(slot)
            totals[key] = totals.get(key, 0) + int(slot.minutes or 0)
    rows = []
    for (project_code, project_description, cost_center_code, cost_center_description), minutes in sorted(totals.items(), key=lambda item: (-item[1], item[0][0] or "", item[0][2] or "")):
        display_project_code, display_project_label, _display_project = _project_reference(project_lookup, project_code, project_description)
        display_cost_center_code, display_cost_center_label, _display_cost_center = _cost_center_reference(area_lookup, cost_center_code, cost_center_description)
        rows.append(
            {
                "project_code": display_project_code,
                "project_label": display_project_label,
                "cost_center_code": display_cost_center_code,
                "cost_center_label": display_cost_center_label,
                "minutes": minutes,
                "hours": _hours_from_minutes(minutes),
            }
        )
    return rows


def _build_day_payload(
    day: TimesheetDay,
    project_lookup: dict[str, LocalProject],
    area_lookup: dict[str, OperationalArea],
    mapping_lookup: dict[str, dict[str, TimesheetMapping]],
) -> dict:
    projects = sorted({_project_reference(project_lookup, slot.project_code, slot.project_description)[2] for slot in day.slots if slot.project_code})
    cost_centers = sorted({_cost_center_reference(area_lookup, slot.cost_center_code, slot.cost_center_description)[2] for slot in day.slots if slot.cost_center_code})
    anomaly_reasons = _anomaly_reasons(
        day.worker,
        {
            "check_in": day.check_in,
            "check_out": day.check_out,
            "total_minutes": day.total_minutes,
            "slots": [{"project_code": slot.project_code, "cost_center_code": slot.cost_center_code} for slot in day.slots],
        },
        mapping_lookup,
    )
    return {
        "id": day.id,
        "worker_id": day.worker.id,
        "worker_name": _worker_display_name(day.worker),
        "worker_code": _worker_display_code(day.worker),
        "department": _worker_display_department(day.worker),
        "linked_employee_id": day.worker.tms_employee.id if day.worker.tms_employee else None,
        "linked_employee_has_photo": bool(day.worker.tms_employee and day.worker.tms_employee.photo_jpeg),
        "work_date": day.work_date,
        "check_in": day.check_in,
        "check_out": day.check_out,
        "break_minutes": day.break_minutes,
        "total_minutes": day.total_minutes,
        "total_hours": _hours_from_minutes(day.total_minutes),
        "status": day.status,
        "approval_status": day.approval_status,
        "has_anomalies": bool(anomaly_reasons),
        "anomaly_reasons": anomaly_reasons,
        "projects": projects,
        "cost_centers": cost_centers,
        "supervisor_note": day.supervisor_note,
        "manual_override": day.manual_override,
    }


def _build_calendar_rows(db: Session, days: list[TimesheetDay], worker_ids: list[str], start_date: date, end_date: date) -> list[dict]:
    lookup: dict[tuple[str, date], TimesheetDay] = {(day.worker_id, day.work_date): day for day in days}
    workers_by_id: dict[str, TimesheetWorker] = {}
    for day in days:
        workers_by_id[day.worker_id] = day.worker
    missing_worker_ids = [worker_id for worker_id in worker_ids if worker_id not in workers_by_id]
    if missing_worker_ids:
        for worker in db.scalars(
            select(TimesheetWorker)
            .options(selectinload(TimesheetWorker.tms_employee))
            .where(TimesheetWorker.id.in_(missing_worker_ids))
        ).all():
            workers_by_id[worker.id] = worker
    rows = []
    current = start_date
    dates = []
    while current <= end_date:
        dates.append(current)
        current += timedelta(days=1)
    for worker_id in worker_ids:
        worker = workers_by_id.get(worker_id)
        if worker is None:
            continue
        rows.append(
            {
                "worker_id": worker.id,
                "worker_name": _worker_display_name(worker),
                "worker_code": _worker_display_code(worker),
                "department": _worker_display_department(worker),
                "days": [
                    {
                        "date": work_day,
                        "status": lookup[(worker_id, work_day)].status if (worker_id, work_day) in lookup else None,
                        "approval_status": lookup[(worker_id, work_day)].approval_status if (worker_id, work_day) in lookup else None,
                        "has_entry": (worker_id, work_day) in lookup,
                        "has_anomalies": bool(lookup[(worker_id, work_day)].has_anomalies) if (worker_id, work_day) in lookup else False,
                    }
                    for work_day in dates
                ],
            }
        )
    return rows


def _query_days(db: Session, *, start: date | None = None, end: date | None = None, worker_id: str | None = None) -> list[TimesheetDay]:
    stmt = (
        select(TimesheetDay)
        .options(
            selectinload(TimesheetDay.worker).selectinload(TimesheetWorker.tms_employee),
            selectinload(TimesheetDay.slots),
            selectinload(TimesheetDay.approved_by_user),
        )
        .join(TimesheetDay.worker)
        .order_by(TimesheetDay.work_date.desc(), TimesheetWorker.full_name.asc())
    )
    if start is not None:
        stmt = stmt.where(TimesheetDay.work_date >= start)
    if end is not None:
        stmt = stmt.where(TimesheetDay.work_date <= end)
    if worker_id:
        stmt = stmt.where(or_(TimesheetDay.worker_id == worker_id, TimesheetWorker.tms_employee_id == worker_id))
    return list(db.scalars(stmt).unique().all())


def build_timesheet_dashboard(db: Session, target_date: date) -> dict:
    active_workers = list(
        db.scalars(
            select(TimesheetWorker)
            .options(selectinload(TimesheetWorker.tms_employee))
            .where(TimesheetWorker.is_active.is_(True))
            .order_by(TimesheetWorker.full_name.asc())
        ).all()
    )
    days = list(
        db.scalars(
            select(TimesheetDay)
            .options(selectinload(TimesheetDay.worker).selectinload(TimesheetWorker.tms_employee), selectinload(TimesheetDay.slots))
            .where(TimesheetDay.work_date == target_date)
            .join(TimesheetDay.worker)
            .order_by(TimesheetWorker.full_name.asc())
        ).unique().all()
    )
    days_by_worker = {day.worker_id: day for day in days}

    compiled_days = [day for day in days if day.status == "COMPILED"]
    confirmed_days = [day for day in days if day.status == "CONFIRMED"]
    approved_days = [day for day in days if day.approval_status == "APPROVED"]
    anomaly_days = [day for day in days if day.has_anomalies]
    missing_workers = [worker for worker in active_workers if worker.id not in days_by_worker]

    range_start = target_date - timedelta(days=13)
    calendar_days = _query_days(db, start=range_start, end=target_date)

    def day_item(day: TimesheetDay) -> dict:
        return {
            "worker_id": day.worker.id,
            "worker_name": _worker_display_name(day.worker),
            "worker_code": _worker_display_code(day.worker),
            "department": _worker_display_department(day.worker),
            "timesheet_id": day.id,
            "work_date": day.work_date,
            "status": day.status,
            "approval_status": day.approval_status,
            "anomaly_reasons": list(day.anomaly_reasons or []),
        }

    def missing_item(worker: TimesheetWorker) -> dict:
        return {
            "worker_id": worker.id,
            "worker_name": _worker_display_name(worker),
            "worker_code": _worker_display_code(worker),
            "department": _worker_display_department(worker),
            "timesheet_id": None,
            "work_date": target_date,
            "status": None,
            "approval_status": None,
            "anomaly_reasons": [],
        }

    return {
        "target_date": target_date,
        "kpis": {
            "operatori_attesi": len(active_workers),
            "giornate_compilate": len(compiled_days),
            "giornate_confermate": len(confirmed_days),
            "giornate_approvate": len(approved_days),
            "giornate_mancanti": len(missing_workers),
            "anomalie": len(anomaly_days),
        },
        "buckets": {
            "operatori_attesi": {
                "count": len(active_workers),
                "items": [missing_item(worker) if worker.id not in days_by_worker else day_item(days_by_worker[worker.id]) for worker in active_workers],
                "calendar": [],
            },
            "giornate_compilate": {
                "count": len(compiled_days),
                "items": [day_item(day) for day in compiled_days],
                "calendar": _build_calendar_rows(db, calendar_days, [day.worker_id for day in compiled_days], range_start, target_date),
            },
            "giornate_confermate": {
                "count": len(confirmed_days),
                "items": [day_item(day) for day in confirmed_days],
                "calendar": _build_calendar_rows(db, calendar_days, [day.worker_id for day in confirmed_days], range_start, target_date),
            },
            "giornate_approvate": {
                "count": len(approved_days),
                "items": [day_item(day) for day in approved_days],
                "calendar": _build_calendar_rows(db, calendar_days, [day.worker_id for day in approved_days], range_start, target_date),
            },
            "giornate_mancanti": {
                "count": len(missing_workers),
                "items": [missing_item(worker) for worker in missing_workers],
                "calendar": _build_calendar_rows(db, calendar_days, [worker.id for worker in missing_workers], range_start, target_date),
            },
            "anomalie": {
                "count": len(anomaly_days),
                "items": [day_item(day) for day in anomaly_days],
                "calendar": _build_calendar_rows(db, calendar_days, [day.worker_id for day in anomaly_days], range_start, target_date),
            },
        },
    }


def build_timesheet_stats(db: Session, *, start: date, end: date) -> dict:
    days = list(
        db.scalars(
            select(TimesheetDay)
            .options(selectinload(TimesheetDay.worker).selectinload(TimesheetWorker.tms_employee), selectinload(TimesheetDay.slots))
            .where(TimesheetDay.work_date >= start, TimesheetDay.work_date <= end)
            .join(TimesheetDay.worker)
            .order_by(TimesheetWorker.full_name.asc())
        ).unique().all()
    )
    mapping_lookup = _mapping_lookup(db)
    project_lookup = _project_lookup_by_external_key(db)

    total_minutes = 0
    pending_count = 0
    anomaly_count = 0
    project_data: dict[str, dict] = {}
    worker_data: dict[str, dict] = {}

    for day in days:
        if day.approval_status == "PENDING":
            pending_count += 1
        if day.has_anomalies:
            anomaly_count += 1
        total_minutes += day.total_minutes

        wid = day.worker.id
        if wid not in worker_data:
            worker_data[wid] = {
                "worker_id": wid,
                "worker_name": _worker_display_name(day.worker),
                "worker_code": _worker_display_code(day.worker),
                "department": _worker_display_department(day.worker),
                "minutes": 0,
                "project_minutes": {},
            }
        worker_data[wid]["minutes"] += day.total_minutes

        for slot in day.slots:
            if not slot.project_code or slot.minutes <= 0:
                continue
            pkey = _normalize_external_reference(slot.project_code)
            local_proj = project_lookup.get(pkey)
            label = (
                (local_proj.name or local_proj.project_code)
                if local_proj
                else (slot.project_description or slot.project_code)
            )
            if pkey not in project_data:
                project_data[pkey] = {"key": pkey, "label": label, "minutes": 0, "worker_ids": set(), "day_count": 0}
            project_data[pkey]["minutes"] += slot.minutes
            project_data[pkey]["worker_ids"].add(wid)
            project_data[pkey]["day_count"] += 1

            if pkey not in worker_data[wid]["project_minutes"]:
                worker_data[wid]["project_minutes"][pkey] = {"key": pkey, "label": label, "minutes": 0}
            worker_data[wid]["project_minutes"][pkey]["minutes"] += slot.minutes

    projects_sorted = sorted(project_data.values(), key=lambda x: x["minutes"], reverse=True)
    workers_sorted = sorted(worker_data.values(), key=lambda x: x["minutes"], reverse=True)

    return {
        "total_hours": _hours_from_minutes(total_minutes),
        "pending_count": pending_count,
        "anomaly_count": anomaly_count,
        "worker_count": len(worker_data),
        "project_count": len(project_data),
        "hours_by_project": [
            {
                "project_key": p["key"],
                "project_label": p["label"],
                "hours": _hours_from_minutes(p["minutes"]),
                "worker_count": len(p["worker_ids"]),
                "day_count": p["day_count"],
            }
            for p in projects_sorted
        ],
        "hours_by_worker": [
            {
                "worker_id": w["worker_id"],
                "worker_name": w["worker_name"],
                "worker_code": w["worker_code"],
                "department": w["department"],
                "hours": _hours_from_minutes(w["minutes"]),
                "top_projects": sorted(
                    [
                        {"key": p["key"], "label": p["label"], "hours": _hours_from_minutes(p["minutes"])}
                        for p in w["project_minutes"].values()
                    ],
                    key=lambda x: x["hours"],
                    reverse=True,
                )[:4],
            }
            for w in workers_sorted
        ],
    }


def list_timesheet_days_payload(
    db: Session,
    *,
    start: date | None,
    end: date | None,
    worker_id: str | None,
    department: str | None,
    project: str | None,
    cost_center: str | None,
    status: str | None,
    approval_status: str | None,
    search: str | None,
) -> list[dict]:
    days = _query_days(db, start=start, end=end, worker_id=worker_id)
    mapping_lookup = _mapping_lookup(db)
    project_lookup = _project_lookup_by_external_key(db)
    area_lookup = _cost_center_lookup_by_external_key(db)
    normalized_search = str(search or "").strip().lower()
    items = []
    for day in days:
        if department and (day.worker.department or "") != department:
            continue
        if status and day.status != status:
            continue
        if approval_status and day.approval_status != approval_status:
            continue
        slot_projects = {slot.project_code for slot in day.slots if slot.project_code}
        slot_cost_centers = {slot.cost_center_code for slot in day.slots if slot.cost_center_code}
        if project and project not in slot_projects:
            continue
        if cost_center and cost_center not in slot_cost_centers:
            continue
        if normalized_search:
            search_blob = " ".join(
                filter(
                    None,
                    [
                        _worker_display_name(day.worker),
                        _worker_display_code(day.worker),
                        day.worker.external_id,
                        day.worker.external_code,
                        day.worker.tms_employee.full_name if day.worker.tms_employee else None,
                        day.worker.tms_employee.tms_id if day.worker.tms_employee else None,
                        _worker_display_department(day.worker),
                        day.supervisor_note,
                        " ".join(sorted(slot_projects)),
                        " ".join(sorted(slot_cost_centers)),
                        " ".join(
                            sorted(
                                _project_reference(project_lookup, slot.project_code, slot.project_description)[2]
                                for slot in day.slots
                                if slot.project_code
                            )
                        ),
                        " ".join(
                            sorted(
                                _cost_center_reference(area_lookup, slot.cost_center_code, slot.cost_center_description)[2]
                                for slot in day.slots
                                if slot.cost_center_code
                            )
                        ),
                    ],
                )
            ).lower()
            if normalized_search not in search_blob:
                continue
        items.append(_build_day_payload(day, project_lookup, area_lookup, mapping_lookup))
    return items


def build_timesheet_filters(db: Session, *, start: date | None, end: date | None) -> dict:
    days = _query_days(db, start=start, end=end)
    project_lookup = _project_lookup_by_external_key(db)
    area_lookup = _cost_center_lookup_by_external_key(db)
    workers = {}
    departments = set()
    projects = {}
    cost_centers = {}
    statuses = set()
    approval_statuses = set()
    for day in days:
        worker_label = _worker_display_name(day.worker)
        worker_code = _worker_display_code(day.worker)
        workers[day.worker.id] = f"{worker_label} ({worker_code})" if worker_code else worker_label
        display_department = _worker_display_department(day.worker)
        if display_department:
            departments.add(display_department)
        statuses.add(day.status)
        approval_statuses.add(day.approval_status)
        for slot in day.slots:
            if slot.project_code:
                projects[slot.project_code] = _project_reference(project_lookup, slot.project_code, slot.project_description)[2] or slot.project_code
            if slot.cost_center_code:
                cost_centers[slot.cost_center_code] = _cost_center_reference(area_lookup, slot.cost_center_code, slot.cost_center_description)[2] or slot.cost_center_code
    return {
        "workers": [{"value": worker_id, "label": workers[worker_id]} for worker_id in sorted(workers, key=lambda item: workers[item])],
        "departments": sorted(departments),
        "projects": [{"value": code, "label": projects[code]} for code in sorted(projects, key=lambda item: projects[item])],
        "cost_centers": [{"value": code, "label": cost_centers[code]} for code in sorted(cost_centers, key=lambda item: cost_centers[item])],
        "statuses": sorted(statuses),
        "approval_statuses": sorted(approval_statuses),
    }


def _timesheet_day_by_id(db: Session, day_id: str) -> TimesheetDay | None:
    return db.scalars(
        select(TimesheetDay)
        .options(
            selectinload(TimesheetDay.worker).selectinload(TimesheetWorker.tms_employee),
            selectinload(TimesheetDay.slots),
            selectinload(TimesheetDay.approved_by_user),
        )
        .where(TimesheetDay.id == day_id)
    ).first()


def build_timesheet_detail(db: Session, day_id: str) -> dict | None:
    day = _timesheet_day_by_id(db, day_id)
    if day is None:
        return None

    week_start = day.work_date - timedelta(days=day.work_date.weekday())
    week_end = week_start + timedelta(days=6)
    month_start = day.work_date.replace(day=1)
    next_month = (month_start.replace(day=28) + timedelta(days=4)).replace(day=1)
    month_end = next_month - timedelta(days=1)
    mapping_lookup = _mapping_lookup(db)
    project_lookup = _project_lookup_by_external_key(db)
    area_lookup = _cost_center_lookup_by_external_key(db)

    week_days = _query_days(db, start=week_start, end=week_end, worker_id=day.worker_id)
    month_days = _query_days(db, start=month_start, end=month_end, worker_id=day.worker_id)

    payload = _build_day_payload(day, project_lookup, area_lookup, mapping_lookup)
    payload.update(
        {
            "worker_external_id": day.worker.external_id,
            "worker_external_code": day.worker.external_code,
            "company": _worker_display_company(day.worker),
            "role_name": _worker_display_role(day.worker),
            "correction_note": day.correction_note,
            "approved_at": day.approved_at,
            "approved_by": day.approved_by_user.display_name if day.approved_by_user and day.approved_by_user.display_name else day.approved_by_user.username if day.approved_by_user else None,
            "slots": [_serialize_slot(slot) for slot in sorted(day.slots, key=lambda slot: slot.sequence)],
            "day_allocations": _build_allocations([day], project_lookup, area_lookup),
            "week_allocations": _build_allocations(week_days, project_lookup, area_lookup),
            "month_allocations": _build_allocations(month_days, project_lookup, area_lookup),
        }
    )
    return payload


def approve_timesheet_day(db: Session, day_id: str, current_user: User, note: str | None = None) -> dict | None:
    day = _timesheet_day_by_id(db, day_id)
    if day is None:
        return None
    day.approval_status = "APPROVED"
    day.approved_at = utcnow()
    day.approved_by_user_id = current_user.id
    if note:
        day.supervisor_note = note
    record_audit_log(
        db,
        action="approve",
        entity="timesheet_day",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"timesheet_day_id": day.id, "note": note},
    )
    db.commit()
    return build_timesheet_detail(db, day.id)


def request_timesheet_correction(db: Session, day_id: str, current_user: User, note: str) -> dict | None:
    day = _timesheet_day_by_id(db, day_id)
    if day is None:
        return None
    day.approval_status = "CORRECTION_REQUESTED"
    day.correction_note = note
    record_audit_log(
        db,
        action="request_correction",
        entity="timesheet_day",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"timesheet_day_id": day.id, "note": note},
    )
    db.commit()
    return build_timesheet_detail(db, day.id)


def manual_update_timesheet_day(db: Session, day_id: str, current_user: User, payload: dict) -> dict | None:
    day = _timesheet_day_by_id(db, day_id)
    if day is None:
        return None

    if payload.get("status"):
        day.status = _normalize_source_status(payload["status"])
    if "check_in" in payload:
        day.check_in = payload.get("check_in")
    if "check_out" in payload:
        day.check_out = payload.get("check_out")
    if payload.get("break_minutes") is not None:
        day.break_minutes = max(int(payload["break_minutes"]), 0)
    if "supervisor_note" in payload:
        day.supervisor_note = payload.get("supervisor_note")
    if "correction_note" in payload:
        day.correction_note = payload.get("correction_note")

    slot_inputs = payload.get("slots") or []
    if slot_inputs:
        normalized_slots = []
        for index, slot_input in enumerate(slot_inputs, start=1):
            start_time = slot_input.get("start_time")
            end_time = slot_input.get("end_time")
            break_minutes = max(int(slot_input.get("break_minutes") or 0), 0)
            normalized_slots.append(
                {
                    "sequence": index,
                    "start_time": start_time,
                    "end_time": end_time,
                    "break_minutes": break_minutes,
                    "minutes": _minutes_between(start_time, end_time, break_minutes),
                    "project_code": _clean_text(slot_input.get("project_code")),
                    "project_description": _clean_text(slot_input.get("project_description")),
                    "cost_center_code": _clean_text(slot_input.get("cost_center_code")),
                    "cost_center_description": _clean_text(slot_input.get("cost_center_description")),
                    "notes": _clean_text(slot_input.get("notes")),
                    "source_payload": {},
                }
            )
        _replace_slots(day, normalized_slots)
        day.break_minutes = sum(slot["break_minutes"] for slot in normalized_slots)
        day.total_minutes = sum(slot["minutes"] for slot in normalized_slots)
        start_candidates = [slot["start_time"] for slot in normalized_slots if slot["start_time"] is not None]
        end_candidates = [slot["end_time"] for slot in normalized_slots if slot["end_time"] is not None]
        day.check_in = min(start_candidates) if start_candidates else day.check_in
        day.check_out = max(end_candidates) if end_candidates else day.check_out
    elif day.check_in and day.check_out:
        day.total_minutes = _minutes_between(day.check_in, day.check_out, day.break_minutes)

    mapping_lookup = _mapping_lookup(db)
    anomaly_payload = {
        "check_in": day.check_in,
        "check_out": day.check_out,
        "total_minutes": day.total_minutes,
        "slots": [{"project_code": slot.project_code, "cost_center_code": slot.cost_center_code} for slot in day.slots],
    }
    reasons = _anomaly_reasons(day.worker, anomaly_payload, mapping_lookup)
    day.anomaly_reasons = reasons
    day.anomaly_count = len(reasons)
    day.has_anomalies = bool(reasons)
    day.manual_override = True

    record_audit_log(
        db,
        action="manual_update",
        entity="timesheet_day",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={"timesheet_day_id": day.id},
    )
    db.commit()
    return build_timesheet_detail(db, day.id)


def build_timesheets_csv(
    db: Session,
    *,
    start: date | None,
    end: date | None,
    worker_id: str | None,
    department: str | None,
    project: str | None,
    cost_center: str | None,
    status: str | None,
    approval_status: str | None,
    search: str | None,
) -> str:
    rows = list_timesheet_days_payload(
        db,
        start=start,
        end=end,
        worker_id=worker_id,
        department=department,
        project=project,
        cost_center=cost_center,
        status=status,
        approval_status=approval_status,
        search=search,
    )
    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow(["Operatore", "Matricola", "Reparto", "Data", "Entrata", "Uscita", "Pausa", "Ore", "Stato", "Approvazione", "Commesse", "Centri di costo", "Anomalie"])
    for row in rows:
        writer.writerow(
            [
                row["worker_name"],
                row.get("worker_code") or "",
                row["department"] or "",
                row["work_date"].isoformat(),
                row["check_in"].isoformat() if row["check_in"] else "",
                row["check_out"].isoformat() if row["check_out"] else "",
                row["break_minutes"],
                row["total_hours"],
                row["status"],
                row["approval_status"],
                ", ".join(row["projects"]),
                ", ".join(row["cost_centers"]),
                " | ".join(row["anomaly_reasons"]),
            ]
        )
    return buffer.getvalue()


def _serialize_sync_run(run: TimesheetSyncRun | None) -> dict | None:
    if run is None:
        return None
    return {
        "id": run.id,
        "trigger_source": run.trigger_source,
        "status": run.status,
        "users_read": run.users_read,
        "users_upserted": run.users_upserted,
        "timesheets_read": run.timesheets_read,
        "timesheets_upserted": run.timesheets_upserted,
        "errors_count": run.errors_count,
        "error_message": run.error_message,
        "raw_summary": run.raw_summary or {},
        "started_at": run.started_at,
        "finished_at": run.finished_at,
    }


def list_sync_runs_payload(db: Session, limit: int = 50) -> list[dict]:
    runs = list(db.scalars(select(TimesheetSyncRun).order_by(TimesheetSyncRun.started_at.desc()).limit(limit)).all())
    return [_serialize_sync_run(run) for run in runs]


def _serialize_worker_link(worker: TimesheetWorker, suggested_employee: Employee | None = None) -> dict:
    linked_employee = worker.tms_employee
    return {
        "id": worker.id,
        "external_id": worker.external_id,
        "external_code": worker.external_code,
        "full_name": worker.full_name,
        "department": worker.department,
        "company": worker.company,
        "role_name": worker.role_name,
        "tms_employee_id": worker.tms_employee_id,
        "tms_employee_name": linked_employee.full_name if linked_employee else None,
        "tms_employee_tms_id": linked_employee.tms_id if linked_employee else None,
        "suggested_employee_id": suggested_employee.id if suggested_employee and worker.tms_employee_id is None else None,
        "suggested_employee_name": suggested_employee.full_name if suggested_employee and worker.tms_employee_id is None else None,
        "suggested_employee_tms_id": suggested_employee.tms_id if suggested_employee and worker.tms_employee_id is None else None,
        "is_active": worker.is_active,
        "is_linked_to_employee": worker.tms_employee_id is not None,
        "last_synced_at": worker.last_synced_at,
        "created_at": worker.created_at,
        "updated_at": worker.updated_at,
    }


def list_worker_links_payload(db: Session, search: str | None = None) -> list[dict]:
    stmt = select(TimesheetWorker).options(selectinload(TimesheetWorker.tms_employee))
    normalized_search = str(search or "").strip()
    if normalized_search:
        pattern = f"%{normalized_search}%"
        stmt = stmt.where(
            or_(
                TimesheetWorker.full_name.ilike(pattern),
                TimesheetWorker.external_id.ilike(pattern),
                TimesheetWorker.external_code.ilike(pattern),
                TimesheetWorker.department.ilike(pattern),
                TimesheetWorker.company.ilike(pattern),
            )
        )
    stmt = stmt.order_by(TimesheetWorker.is_active.desc(), TimesheetWorker.full_name.asc(), TimesheetWorker.external_id.asc())
    workers = list(db.scalars(stmt).all())
    employee_by_tms_id = {
        employee.tms_id: employee
        for employee in db.scalars(select(Employee).where(Employee.is_active.is_(True))).all()
    }
    return [
        _serialize_worker_link(
            worker,
            suggested_employee=next(
                (employee_by_tms_id[code] for code in _worker_employee_codes(worker) if code in employee_by_tms_id),
                None,
            ),
        )
        for worker in workers
    ]


def update_worker_link(db: Session, worker_id: str, tms_employee_id: str | None, current_user: User) -> dict | None:
    worker = db.scalar(
        select(TimesheetWorker).where(TimesheetWorker.id == worker_id).options(selectinload(TimesheetWorker.tms_employee))
    )
    if worker is None:
        return None

    previous_tms_employee_id = worker.tms_employee_id
    if tms_employee_id is None:
        worker.tms_employee_id = None
    else:
        employee = db.get(Employee, tms_employee_id)
        if employee is None:
            raise RuntimeError("Dipendente locale non trovato.")

        existing_link = db.scalar(
            select(TimesheetWorker).where(
                TimesheetWorker.tms_employee_id == tms_employee_id,
                TimesheetWorker.id != worker.id,
            )
        )
        if existing_link is not None:
            raise RuntimeError("Dipendente locale gia collegato a un altro operatore AWS.")

        worker.tms_employee_id = employee.id

    _recompute_worker_day_anomalies(db, worker)
    record_audit_log(
        db,
        action="update",
        entity="timesheet_worker_link",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "timesheet_worker_id": worker.id,
            "before": previous_tms_employee_id,
            "after": worker.tms_employee_id,
        },
    )
    db.commit()
    db.refresh(worker)
    return _serialize_worker_link(worker)


def delete_worker(db: Session, worker_id: str, current_user: User) -> bool:
    worker = db.get(TimesheetWorker, worker_id)
    if worker is None:
        return False
    record_audit_log(
        db,
        action="delete",
        entity="timesheet_worker",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "timesheet_worker_id": worker.id,
            "external_id": worker.external_id,
            "external_code": worker.external_code,
            "full_name": worker.full_name,
        },
    )
    db.delete(worker)
    db.commit()
    return True


def scheduler_running() -> bool:
    return _scheduler_thread is not None and _scheduler_thread.is_alive()


def build_admin_overview(db: Session) -> dict:
    workers = list(db.scalars(select(TimesheetWorker)).all())
    days_total = db.scalar(select(func.count(TimesheetDay.id))) or 0
    pending = db.scalar(select(func.count(TimesheetDay.id)).where(TimesheetDay.approval_status == "PENDING")) or 0
    anomalies = db.scalar(select(func.count(TimesheetDay.id)).where(TimesheetDay.has_anomalies.is_(True))) or 0
    mapping_lookup = _mapping_lookup(db)

    unmapped_workers = sum(1 for worker in workers if worker.is_active and worker.tms_employee_id is None)
    all_slots = list(db.scalars(select(TimesheetSlot)).all())
    project_codes = {slot.project_code for slot in all_slots if slot.project_code}
    cost_center_codes = {slot.cost_center_code for slot in all_slots if slot.cost_center_code}

    last_sync = db.scalars(select(TimesheetSyncRun).order_by(TimesheetSyncRun.started_at.desc()).limit(1)).first()
    return {
        "sync_configured": settings.aws_sync_is_configured,
        "scheduler_running": scheduler_running(),
        "sync_interval_minutes": settings.aws_sync_interval_minutes,
        "total_workers": len(workers),
        "active_workers": sum(1 for worker in workers if worker.is_active),
        "total_days": int(days_total),
        "pending_approvals": int(pending),
        "anomaly_days": int(anomalies),
        "unmapped_workers": unmapped_workers,
        "unmapped_projects": sum(1 for code in project_codes if _normalize_external_reference(code) not in mapping_lookup["project"]),
        "unmapped_cost_centers": sum(1 for code in cost_center_codes if _normalize_external_reference(code) not in mapping_lookup["cost_center"]),
        "last_sync": _serialize_sync_run(last_sync),
    }


def list_mappings_payload(db: Session, mapping_type: str | None = None) -> list[dict]:
    stmt = select(TimesheetMapping).order_by(TimesheetMapping.mapping_type.asc(), TimesheetMapping.external_key.asc())
    if mapping_type:
        stmt = stmt.where(TimesheetMapping.mapping_type == _normalize_mapping_type(mapping_type))
    mappings = list(db.scalars(stmt).all())
    return [
        {
            "id": mapping.id,
            "mapping_type": mapping.mapping_type,
            "external_key": mapping.external_key,
            "external_label": mapping.external_label,
            "internal_key": mapping.internal_key,
            "internal_label": mapping.internal_label,
            "notes": mapping.notes,
            "is_active": mapping.is_active,
            "created_at": mapping.created_at,
            "updated_at": mapping.updated_at,
        }
        for mapping in mappings
    ]


def list_project_links_payload(db: Session) -> list[dict]:
    mappings = {
        _normalize_external_reference(mapping.external_key): mapping
        for mapping in db.scalars(
            select(TimesheetMapping)
            .where(TimesheetMapping.mapping_type == "project")
            .order_by(TimesheetMapping.external_key.asc())
        ).all()
        if _normalize_external_reference(mapping.external_key)
    }
    project_by_id = {
        project.id: project
        for project in db.scalars(select(LocalProject)).all()
    }
    labels_by_code: dict[str, str | None] = {}
    for slot in db.scalars(select(TimesheetSlot).where(TimesheetSlot.project_code.is_not(None))).all():
        code = _clean_text(slot.project_code)
        if not code:
            continue
        if code not in labels_by_code or not labels_by_code[code]:
            labels_by_code[code] = _clean_text(slot.project_description)

    rows = []
    for code in sorted(labels_by_code):
        mapping = mappings.get(_normalize_external_reference(code))
        project = project_by_id.get(mapping.internal_key) if mapping and mapping.internal_key else None
        rows.append(
            {
                "external_key": code,
                "external_label": labels_by_code[code],
                "mapping_id": mapping.id if mapping else None,
                "local_project_id": project.id if project else mapping.internal_key if mapping else None,
                "local_project_code": project.project_code if project else None,
                "local_project_name": project.name if project else mapping.internal_label if mapping else None,
                "is_mapped": mapping is not None and bool(mapping.is_active) and project is not None,
            }
        )
    return rows


def upsert_project_link(db: Session, external_key: str, local_project_id: str | None, current_user: User) -> dict:
    normalized_external_key = str(external_key).strip()
    if not normalized_external_key:
        raise RuntimeError("Commessa AWS non valida.")

    mapping = db.scalar(
        select(TimesheetMapping).where(
            TimesheetMapping.mapping_type == "project",
            TimesheetMapping.external_key == normalized_external_key,
        )
    )

    if not local_project_id:
        if mapping is not None:
            record_audit_log(
                db,
                action="delete",
                entity="timesheet_mapping",
                actor_name=current_user.username,
                user_id=current_user.id,
                detail={"id": mapping.id, "mapping_type": "project", "external_key": normalized_external_key},
            )
            db.delete(mapping)
            _recompute_days_for_mapping_change(db, "project", normalized_external_key)
            db.commit()
        row = next((item for item in list_project_links_payload(db) if item["external_key"] == normalized_external_key), None)
        if row is None:
            raise RuntimeError("Commessa AWS non trovata.")
        return row

    project = db.get(LocalProject, local_project_id)
    if project is None:
        raise RuntimeError("Commessa locale non trovata.")

    external_label = db.scalar(
        select(TimesheetSlot.project_description)
        .where(TimesheetSlot.project_code == normalized_external_key, TimesheetSlot.project_description.is_not(None))
        .order_by(TimesheetSlot.project_description.asc())
        .limit(1)
    )

    payload = {
        "mapping_type": "project",
        "external_key": normalized_external_key,
        "external_label": _clean_text(external_label),
        "internal_key": project.id,
        "internal_label": project.name,
        "notes": None,
        "is_active": True,
    }

    if mapping is None:
        mapping = TimesheetMapping(**payload)
        db.add(mapping)
        action = "create"
    else:
        mapping.external_label = payload["external_label"]
        mapping.internal_key = payload["internal_key"]
        mapping.internal_label = payload["internal_label"]
        mapping.notes = None
        mapping.is_active = True
        action = "update"

    record_audit_log(
        db,
        action=action,
        entity="timesheet_mapping",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=payload if action == "create" else {"id": mapping.id, **payload},
    )
    _recompute_days_for_mapping_change(db, "project", normalized_external_key)
    db.commit()
    row = next((item for item in list_project_links_payload(db) if item["external_key"] == normalized_external_key), None)
    if row is None:
        raise RuntimeError("Commessa AWS non trovata.")
    return row


def list_cost_center_links_payload(db: Session) -> list[dict]:
    mappings = {
        _normalize_external_reference(mapping.external_key): mapping
        for mapping in db.scalars(
            select(TimesheetMapping)
            .where(TimesheetMapping.mapping_type == "cost_center")
            .order_by(TimesheetMapping.external_key.asc())
        ).all()
        if _normalize_external_reference(mapping.external_key)
    }
    area_by_code = {
        area.area_code: area
        for area in db.scalars(select(OperationalArea)).all()
    }
    labels_by_code: dict[str, str | None] = {}
    for slot in db.scalars(select(TimesheetSlot).where(TimesheetSlot.cost_center_code.is_not(None))).all():
        code = _clean_text(slot.cost_center_code)
        if not code:
            continue
        if code not in labels_by_code or not labels_by_code[code]:
            labels_by_code[code] = _clean_text(slot.cost_center_description)

    rows = []
    for code in sorted(labels_by_code):
        mapping = mappings.get(_normalize_external_reference(code))
        area = area_by_code.get(mapping.internal_key) if mapping and mapping.internal_key else None
        rows.append(
            {
                "external_key": code,
                "external_label": labels_by_code[code],
                "mapping_id": mapping.id if mapping else None,
                "operational_area_code": area.area_code if area else mapping.internal_key if mapping else None,
                "operational_area_name": area.name if area else mapping.internal_label if mapping else None,
                "is_mapped": mapping is not None and bool(mapping.is_active) and bool(mapping.internal_key),
            }
        )
    return rows


def upsert_cost_center_link(db: Session, external_key: str, operational_area_code: str | None, current_user: User) -> dict:
    normalized_external_key = str(external_key).strip()
    if not normalized_external_key:
        raise RuntimeError("Centro di costo AWS non valido.")

    mapping = db.scalar(
        select(TimesheetMapping).where(
            TimesheetMapping.mapping_type == "cost_center",
            TimesheetMapping.external_key == normalized_external_key,
        )
    )

    if not operational_area_code:
        if mapping is not None:
            record_audit_log(
                db,
                action="delete",
                entity="timesheet_mapping",
                actor_name=current_user.username,
                user_id=current_user.id,
                detail={"id": mapping.id, "mapping_type": "cost_center", "external_key": normalized_external_key},
            )
            db.delete(mapping)
            _recompute_days_for_mapping_change(db, "cost_center", normalized_external_key)
            db.commit()
        row = next((item for item in list_cost_center_links_payload(db) if item["external_key"] == normalized_external_key), None)
        if row is None:
            raise RuntimeError("Centro di costo AWS non trovato.")
        return row

    area = db.scalar(
        select(OperationalArea).where(
            func.lower(OperationalArea.area_code) == str(operational_area_code).strip().lower()
        )
    )
    if area is None:
        raise RuntimeError("Area Operativa non trovata.")

    external_label = db.scalar(
        select(TimesheetSlot.cost_center_description)
        .where(TimesheetSlot.cost_center_code == normalized_external_key, TimesheetSlot.cost_center_description.is_not(None))
        .order_by(TimesheetSlot.cost_center_description.asc())
        .limit(1)
    )

    payload = {
        "mapping_type": "cost_center",
        "external_key": normalized_external_key,
        "external_label": _clean_text(external_label),
        "internal_key": area.area_code,
        "internal_label": area.name,
        "notes": None,
        "is_active": True,
    }

    if mapping is None:
        mapping = TimesheetMapping(**payload)
        db.add(mapping)
        action = "create"
    else:
        mapping.external_label = payload["external_label"]
        mapping.internal_key = payload["internal_key"]
        mapping.internal_label = payload["internal_label"]
        mapping.notes = None
        mapping.is_active = True
        action = "update"

    record_audit_log(
        db,
        action=action,
        entity="timesheet_mapping",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail=payload if action == "create" else {"id": mapping.id, **payload},
    )
    _recompute_days_for_mapping_change(db, "cost_center", normalized_external_key)
    db.commit()
    row = next((item for item in list_cost_center_links_payload(db) if item["external_key"] == normalized_external_key), None)
    if row is None:
        raise RuntimeError("Centro di costo AWS non trovato.")
    return row


def create_mapping(db: Session, payload: dict, current_user: User) -> dict:
    mapping = TimesheetMapping(
        mapping_type=_normalize_mapping_type(payload["mapping_type"]),
        external_key=str(payload["external_key"]).strip(),
        external_label=_clean_text(payload.get("external_label")),
        internal_key=str(payload["internal_key"]).strip(),
        internal_label=_clean_text(payload.get("internal_label")),
        notes=_clean_text(payload.get("notes")),
        is_active=bool(payload.get("is_active", True)),
    )
    db.add(mapping)
    record_audit_log(db, action="create", entity="timesheet_mapping", actor_name=current_user.username, user_id=current_user.id, detail=payload)
    db.commit()
    db.refresh(mapping)
    return {
        "id": mapping.id,
        "mapping_type": mapping.mapping_type,
        "external_key": mapping.external_key,
        "external_label": mapping.external_label,
        "internal_key": mapping.internal_key,
        "internal_label": mapping.internal_label,
        "notes": mapping.notes,
        "is_active": mapping.is_active,
        "created_at": mapping.created_at,
        "updated_at": mapping.updated_at,
    }


def update_mapping(db: Session, mapping_id: str, payload: dict, current_user: User) -> dict | None:
    mapping = db.get(TimesheetMapping, mapping_id)
    if mapping is None:
        return None
    if payload.get("internal_key") is not None:
        mapping.internal_key = str(payload["internal_key"]).strip()
    if "external_label" in payload:
        mapping.external_label = _clean_text(payload.get("external_label"))
    if "internal_label" in payload:
        mapping.internal_label = _clean_text(payload.get("internal_label"))
    if "notes" in payload:
        mapping.notes = _clean_text(payload.get("notes"))
    if "is_active" in payload and payload.get("is_active") is not None:
        mapping.is_active = bool(payload.get("is_active"))
    record_audit_log(db, action="update", entity="timesheet_mapping", actor_name=current_user.username, user_id=current_user.id, detail={"id": mapping_id, **payload})
    db.commit()
    db.refresh(mapping)
    return {
        "id": mapping.id,
        "mapping_type": mapping.mapping_type,
        "external_key": mapping.external_key,
        "external_label": mapping.external_label,
        "internal_key": mapping.internal_key,
        "internal_label": mapping.internal_label,
        "notes": mapping.notes,
        "is_active": mapping.is_active,
        "created_at": mapping.created_at,
        "updated_at": mapping.updated_at,
    }


def delete_mapping(db: Session, mapping_id: str, current_user: User) -> bool:
    mapping = db.get(TimesheetMapping, mapping_id)
    if mapping is None:
        return False
    record_audit_log(db, action="delete", entity="timesheet_mapping", actor_name=current_user.username, user_id=current_user.id, detail={"id": mapping_id})
    db.delete(mapping)
    db.commit()
    return True


def _resolve_endpoint(override: str, default_path: str) -> str:
    if override and override.startswith("http"):
        return override
    base_url = settings.aws_sync_base_url.strip()
    if not base_url:
        raise RuntimeError("AWS sync non configurata.")
    path = override.strip() if override.strip() else default_path
    return urljoin(base_url.rstrip("/") + "/", path.lstrip("/"))


def _fetch_remote_json(url: str) -> object:
    headers: dict[str, str] = {"Accept": "application/json"}
    api_key = settings.aws_sync_api_key.strip()
    if api_key:
        headers["x-api-key"] = api_key
        headers["Authorization"] = f"Bearer {api_key}"
    request = Request(url, headers=headers, method="GET")
    try:
        with urlopen(request, timeout=30) as response:
            charset = response.headers.get_content_charset("utf-8")
            return json.loads(response.read().decode(charset))
    except HTTPError as exc:
        message = exc.read().decode("utf-8", errors="ignore")
        raise RuntimeError(f"AWS sync HTTP {exc.code}: {message or exc.reason}") from exc
    except URLError as exc:
        raise RuntimeError(f"AWS sync non raggiungibile: {exc.reason}") from exc


def _upsert_workers(db: Session, user_records: list[dict]) -> int:
    now = utcnow()
    existing_workers = {
        worker.external_id: worker
        for worker in db.scalars(select(TimesheetWorker).where(TimesheetWorker.external_id.in_([record["external_id"] for record in user_records]))).all()
    } if user_records else {}
    upserted = 0
    incoming_ids = set()
    for record in user_records:
        incoming_ids.add(record["external_id"])
        worker = existing_workers.get(record["external_id"])
        if worker is None:
            worker = TimesheetWorker(**record, last_synced_at=now)
            db.add(worker)
        else:
            worker.external_code = record["external_code"]
            worker.full_name = record["full_name"]
            worker.department = record["department"]
            worker.company = record["company"]
            worker.role_name = record["role_name"]
            worker.is_active = record["is_active"]
            worker.last_synced_at = now
            worker.raw_payload = record["raw_payload"]
        _link_worker_to_matching_employee(db, worker)
        upserted += 1
    for worker in db.scalars(select(TimesheetWorker).where(TimesheetWorker.is_active.is_(True))).all():
        if incoming_ids and worker.external_id not in incoming_ids:
            worker.is_active = False
    return upserted


def _upsert_days(db: Session, day_records: list[dict]) -> int:
    if not day_records:
        return 0
    mapping_lookup = _mapping_lookup(db)
    worker_ids = {record["worker_external_id"] for record in day_records}
    workers = {worker.external_id: worker for worker in db.scalars(select(TimesheetWorker).where(TimesheetWorker.external_id.in_(worker_ids))).all()}
    upserted = 0

    existing_days = {
        (day.worker.external_id, day.work_date): day
        for day in db.scalars(
            select(TimesheetDay)
            .options(selectinload(TimesheetDay.worker), selectinload(TimesheetDay.slots))
            .join(TimesheetDay.worker)
            .where(TimesheetWorker.external_id.in_(worker_ids))
        ).unique().all()
    }

    for record in day_records:
        worker = workers.get(record["worker_external_id"])
        if worker is None:
            worker = _ensure_worker(db, record)
            workers[worker.external_id] = worker
        key = (worker.external_id, record["work_date"])
        day = existing_days.get(key)
        is_new = day is None
        if day is None:
            day = TimesheetDay(worker_id=worker.id, work_date=record["work_date"])
            db.add(day)
            db.flush()
            existing_days[key] = day
        day.external_day_id = record["external_day_id"]
        day.status = record["status"]
        day.source_payload = record["source_payload"]
        day.supervisor_note = record["supervisor_note"]
        if is_new:
            day.approval_status = "APPROVED" if record["status"] == "APPROVED" else "PENDING"
        elif day.approval_status == "PENDING" and record["status"] == "APPROVED":
            day.approval_status = "APPROVED"
        if not day.manual_override:
            day.check_in = record["check_in"]
            day.check_out = record["check_out"]
            day.break_minutes = int(record["break_minutes"] or 0)
            day.total_minutes = int(record["total_minutes"] or 0)
            _replace_slots(day, record["slots"])
        reasons = _anomaly_reasons(
            worker,
            record if not day.manual_override else {
                "check_in": day.check_in,
                "check_out": day.check_out,
                "total_minutes": day.total_minutes,
                "slots": [{"project_code": slot.project_code, "cost_center_code": slot.cost_center_code} for slot in day.slots],
            },
            mapping_lookup,
        )
        day.anomaly_reasons = reasons
        day.anomaly_count = len(reasons)
        day.has_anomalies = bool(reasons)
        upserted += 1
    return upserted


def sync_timesheets(db: Session, *, trigger_source: str, actor_name: str | None = None, user_id: str | None = None) -> dict:
    if not settings.aws_sync_is_configured:
        raise RuntimeError("AWS sync non configurata.")

    run = TimesheetSyncRun(trigger_source=trigger_source, status="RUNNING")
    db.add(run)
    db.commit()
    db.refresh(run)

    try:
        users_url = _resolve_endpoint(settings.aws_sync_users_endpoint, "/sync/users")
        timesheets_url = _resolve_endpoint(settings.aws_sync_timesheets_endpoint, "/sync/timesheets")

        users_payload = _fetch_remote_json(users_url)
        timesheets_payload = _fetch_remote_json(timesheets_url)

        user_records = [item for item in (_normalize_user_record(record) for record in _extract_list(users_payload, ("users",))) if item]
        day_records = [item for item in (_normalize_timesheet_record(record) for record in _extract_list(timesheets_payload, ("timesheets",))) if item]

        run.users_read = len(user_records)
        run.users_upserted = _upsert_workers(db, user_records)
        run.timesheets_read = len(day_records)
        run.timesheets_upserted = _upsert_days(db, day_records)
        run.status = "SUCCESS"
        run.raw_summary = {"users_endpoint": users_url, "timesheets_endpoint": timesheets_url}
        run.finished_at = utcnow()

        if trigger_source == "manual":
            record_audit_log(
                db,
                action="manual_sync",
                entity="timesheets",
                actor_name=actor_name,
                user_id=user_id,
                detail={
                    "timesheet_sync_run_id": run.id,
                    "users_read": run.users_read,
                    "timesheets_read": run.timesheets_read,
                },
            )

        db.commit()
        db.refresh(run)
        return _serialize_sync_run(run)
    except Exception as exc:
        db.rollback()
        failed_run = db.get(TimesheetSyncRun, run.id)
        if failed_run is not None:
            failed_run.status = "FAILED"
            failed_run.errors_count = 1
            failed_run.error_message = str(exc)
            failed_run.finished_at = utcnow()
            db.commit()
        raise


def _scheduler_loop() -> None:
    while not _scheduler_stop.is_set():
        with SessionLocal() as session:
            try:
                sync_timesheets(session, trigger_source="scheduled")
            except Exception:
                session.rollback()
        if _scheduler_stop.wait(max(settings.aws_sync_interval_minutes, 1) * 60):
            break


def start_timesheet_sync_scheduler() -> None:
    global _scheduler_thread
    if not settings.aws_sync_is_configured:
        return
    with _scheduler_lock:
        if _scheduler_thread is not None and _scheduler_thread.is_alive():
            return
        _scheduler_stop.clear()
        _scheduler_thread = threading.Thread(target=_scheduler_loop, name="timesheet-sync", daemon=True)
        _scheduler_thread.start()


def stop_timesheet_sync_scheduler() -> None:
    global _scheduler_thread
    with _scheduler_lock:
        _scheduler_stop.set()
        if _scheduler_thread is not None and _scheduler_thread.is_alive():
            _scheduler_thread.join(timeout=2)
        _scheduler_thread = None

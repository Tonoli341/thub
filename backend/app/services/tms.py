from dataclasses import dataclass
from datetime import date, datetime, timezone
from io import BytesIO

import pytds
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Employee
from app.schemas import EmployeeSyncResult
from app.services.audit import record_audit_log
from app.services.normalization import normalize_phone


@dataclass
class TmsEmployeeRecord:
    tms_id: str
    full_name: str
    phone: str | None
    tms_role_code: str | None
    tms_role_description: str | None
    contract_type: str | None
    datore_lavoro: str | None
    photo_jpeg: bytes | None


@dataclass
class TmsEmployeeExpirationRecord:
    code: str
    type_code: str | None
    type_description: str | None
    expiration_date: date | None
    issue_date: date | None
    issuing_authority: str | None
    document_number: str | None


DATORE_LAVORO_LABELS = {
    "1": "TONOLI SPEDIZIONI SRL",
    "323": "TONOLI PORTUGUESA SPEDIZIONI TRANSPORTES LDA",
    "535": "SERVIZI TONOLI SCRL",
}


def convert_tms_photo_to_jpeg(photo_blob: object) -> bytes | None:
    if photo_blob is None:
        return None

    if isinstance(photo_blob, memoryview):
        photo_bytes = photo_blob.tobytes()
    elif isinstance(photo_blob, bytearray):
        photo_bytes = bytes(photo_blob)
    elif isinstance(photo_blob, bytes):
        photo_bytes = photo_blob
    else:
        return None

    if not photo_bytes:
        return None

    try:
        from PIL import Image, ImageOps, UnidentifiedImageError
    except ImportError as exc:
        raise RuntimeError("Pillow is required to convert TMS employee photos. Install backend dependencies again.") from exc

    try:
        with Image.open(BytesIO(photo_bytes)) as image:
            normalized = ImageOps.exif_transpose(image)
            converted = ImageOps.fit(normalized.convert("RGB"), (64, 64), method=Image.Resampling.LANCZOS)
            output = BytesIO()
            converted.save(output, format="JPEG", quality=70, optimize=True)
            return output.getvalue()
    except (UnidentifiedImageError, OSError):
        return None


def split_full_name(full_name: str) -> tuple[str | None, str | None]:
    normalized = " ".join(full_name.split())
    if not normalized:
        return None, None
    if "," in normalized:
        last_name, first_name = [part.strip() or None for part in normalized.split(",", 1)]
        return first_name, last_name
    tokens = normalized.split(" ")
    if len(tokens) == 1:
        return None, tokens[0]
    first_name = tokens[-1]
    last_name = " ".join(tokens[:-1])
    return first_name, last_name


def resolve_datore_lavoro(value: object) -> str | None:
    code = str(value or "").strip()
    if not code:
        return None
    return DATORE_LAVORO_LABELS.get(code, code)


def normalize_tms_date(value: object) -> date | None:
    if value is None:
        return None
    if isinstance(value, date) and not isinstance(value, datetime):
        return value
    if isinstance(value, datetime):
        return value.date()
    value_str = str(value).strip()
    if not value_str:
        return None
    try:
        return datetime.fromisoformat(value_str).date()
    except ValueError:
        return None


def fetch_employees_from_tms() -> list[TmsEmployeeRecord]:
    if not settings.tms_username or not settings.tms_password:
        raise RuntimeError("TMS credentials missing. Configure TMS_USERNAME and TMS_PASSWORD in .env.")

    query = settings.resolved_tms_employee_query
    rows_by_tms_id: dict[str, TmsEmployeeRecord] = {}

    with pytds.connect(
        server=settings.tms_host,
        database=settings.tms_database,
        user=settings.tms_username,
        password=settings.tms_password,
        port=settings.tms_port,
        timeout=10,
        login_timeout=10,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()

        for row in rows:
            if len(row) == 8:
                code, full_name, phone, role_code, role_description, contract_type_raw, datore_lavoro_code, photo_blob = row
            elif len(row) == 7:
                code, full_name, phone, role_code, role_description, datore_lavoro_code, photo_blob = row
                contract_type_raw = None
            elif len(row) == 6:
                code, full_name, phone, role_code, role_description, photo_blob = row
                datore_lavoro_code = None
                contract_type_raw = None
            elif len(row) == 5:
                full_name, phone, code, datore_lavoro_code, photo_blob = row
                role_code = None
                role_description = None
                contract_type_raw = None
            elif len(row) == 4:
                full_name, phone, code, photo_blob = row
                role_code = None
                role_description = None
                datore_lavoro_code = None
                contract_type_raw = None
            else:
                raise RuntimeError(
                    "Unexpected TMS employee row format: expected 4–8 columns including FOTO, "
                    f"got {len(row)}."
                )

            if code is None:
                continue
            tms_id = str(code).strip()
            candidate = TmsEmployeeRecord(
                tms_id=tms_id,
                full_name=str(full_name or "").strip(),
                phone=normalize_phone(str(phone) if phone else None),
                tms_role_code=str(role_code).strip() if role_code else None,
                tms_role_description=str(role_description).strip() if role_description else "ALTRO",
                contract_type=str(contract_type_raw).strip() if contract_type_raw else None,
                datore_lavoro=resolve_datore_lavoro(datore_lavoro_code),
                photo_jpeg=convert_tms_photo_to_jpeg(photo_blob),
            )
            current = rows_by_tms_id.get(tms_id)
            if current is None:
                rows_by_tms_id[tms_id] = candidate
                continue

            if (not current.phone) and candidate.phone:
                current.phone = candidate.phone
            if (not current.contract_type) and candidate.contract_type:
                current.contract_type = candidate.contract_type
            if (not current.datore_lavoro) and candidate.datore_lavoro:
                current.datore_lavoro = candidate.datore_lavoro
            if (not current.photo_jpeg) and candidate.photo_jpeg:
                current.photo_jpeg = candidate.photo_jpeg
            if (
                current.tms_role_description in (None, "", "ALTRO")
                and candidate.tms_role_description not in (None, "", "ALTRO")
            ):
                current.tms_role_code = candidate.tms_role_code
                current.tms_role_description = candidate.tms_role_description

    return list(rows_by_tms_id.values())


def fetch_employee_expirations_from_tms(employee_code: str) -> list[TmsEmployeeExpirationRecord]:
    if not settings.tms_username or not settings.tms_password:
        raise RuntimeError("TMS credentials missing. Configure TMS_USERNAME and TMS_PASSWORD in .env.")

    query = settings.resolve_tms_employee_expirations_query(employee_code.strip())
    records: list[TmsEmployeeExpirationRecord] = []

    with pytds.connect(
        server=settings.tms_host,
        database=settings.tms_database,
        user=settings.tms_username,
        password=settings.tms_password,
        port=settings.tms_port,
        timeout=10,
        login_timeout=10,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(query)
            rows = cursor.fetchall()

        for row in rows:
            if len(row) != 7:
                raise RuntimeError(
                    "Unexpected TMS employee expirations row format: expected 7 columns, "
                    f"got {len(row)}."
                )
            (
                code,
                type_code,
                type_description,
                expiration_date,
                issue_date,
                issuing_authority,
                document_number,
            ) = row
            if code is None:
                continue
            records.append(
                TmsEmployeeExpirationRecord(
                    code=str(code).strip(),
                    type_code=str(type_code).strip() if type_code else None,
                    type_description=str(type_description).strip() if type_description else None,
                    expiration_date=normalize_tms_date(expiration_date),
                    issue_date=normalize_tms_date(issue_date),
                    issuing_authority=str(issuing_authority).strip() if issuing_authority else None,
                    document_number=str(document_number).strip() if document_number else None,
                )
            )

    return records


def sync_employees(db: Session) -> EmployeeSyncResult:
    records = fetch_employees_from_tms()
    existing_total = db.scalar(select(func.count()).select_from(Employee)) or 0

    if not records and existing_total > 0:
        raise RuntimeError(
            "TMS sync returned zero employees. Sync aborted to avoid mass deactivation from an invalid feed."
        )

    tms_ids = [record.tms_id for record in records]
    current_employees = {
        employee.tms_id: employee
        for employee in db.scalars(select(Employee).where(Employee.tms_id.in_(tms_ids))).all()
    }

    created = 0
    updated = 0
    for record in records:
        first_name, last_name = split_full_name(record.full_name)
        employee = current_employees.get(record.tms_id)
        if employee is None:
            employee = Employee(
                tms_id=record.tms_id,
                full_name=record.full_name or record.tms_id,
                first_name=first_name,
                last_name=last_name,
                phone=record.phone,
                phone_from_tms=record.phone is not None,
                tms_role_code=record.tms_role_code,
                tms_role_description=record.tms_role_description,
                contract_type=record.contract_type,
                datore_lavoro=record.datore_lavoro,
                photo_jpeg=record.photo_jpeg,
                is_active=True,
            )
            db.add(employee)
            current_employees[record.tms_id] = employee
            created += 1
            continue

        employee.full_name = record.full_name or employee.full_name
        employee.first_name = first_name
        employee.last_name = last_name
        employee.phone = record.phone
        employee.phone_from_tms = record.phone is not None
        employee.tms_role_code = record.tms_role_code
        employee.tms_role_description = record.tms_role_description
        employee.contract_type = record.contract_type
        employee.datore_lavoro = record.datore_lavoro
        if record.photo_jpeg:
            employee.photo_jpeg = record.photo_jpeg
        employee.is_active = True
        updated += 1

    deactivated = 0
    if tms_ids:
        employees_to_deactivate = db.scalars(select(Employee).where(~Employee.tms_id.in_(tms_ids), Employee.is_active.is_(True))).all()
        for employee in employees_to_deactivate:
            employee.is_active = False
            deactivated += 1

    synced_at = datetime.now(timezone.utc)
    record_audit_log(
        db,
        action="sync",
        entity="employees",
        actor_name="system",
        detail={
            "source": "tms",
            "fetched": len(records),
            "created": created,
            "updated": updated,
            "deactivated": deactivated,
            "synced_at": synced_at.isoformat(),
        },
    )
    db.commit()

    from app.services.org import propagate_org_inheritance
    propagate_org_inheritance(db)
    db.commit()

    return EmployeeSyncResult(
        fetched=len(records),
        created=created,
        updated=updated,
        deactivated=deactivated,
        synced_at=synced_at,
    )

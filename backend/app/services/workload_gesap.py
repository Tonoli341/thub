"""Regole pure per collegare le prenotazioni ToolTo alle righe dei Carichi."""

from copy import deepcopy
from datetime import date


GESAP_ROW_FIELDS = (
    "client_supplier_code",
    "client_supplier",
    "customer_code",
    "customer_name",
    "supplier_code",
    "supplier_name",
    "inbound_count",
    "outbound_count",
    "notes",
    "warehouse",
    "gesap_booking_id",
    "gesap_booking_date",
    "gesap_status",
    "gesap_locked",
)

CANCELLED_STATUSES = {"ANNULLATO", "ANNULLATA", "CANCELLATO", "CANCELLATA", "ELIMINATO", "ELIMINATA"}


def _text(value: object) -> str:
    return str(value or "").strip()


def booking_id(item: dict) -> str:
    return _text(item.get("id"))


def booking_date(item: dict, fallback: date) -> date:
    raw = _text((item.get("prenotazione") or {}).get("data"))
    try:
        return date.fromisoformat(raw)
    except ValueError:
        return fallback


def is_cancelled_booking(item: dict) -> bool:
    return _text(item.get("stato")).upper() in CANCELLED_STATUSES


def is_gesap_row(row: dict) -> bool:
    return bool(row.get("gesap_booking_id"))


def _booking_notes(item: dict) -> str:
    time_value = _text((item.get("prenotazione") or {}).get("ora")) or "non indicata"
    carrier = _text(item.get("vettore")) or "non indicato"
    parts = [f"Ora ToolTo: {time_value}", f"Vettore: {carrier}"]
    note = _text(item.get("note"))
    if note:
        parts.append(f"Note ToolTo: {note}")
    return "\n".join(parts)


def row_from_booking(item: dict, fallback_date: date, existing: dict | None = None) -> dict:
    movement = _text(item.get("tipo_movimento")).upper()
    customer = item.get("cliente") or {}
    supplier = item.get("fornitore") or {}
    customer_code = _text(customer.get("id")) or None
    customer_name = _text(customer.get("nome")) or None
    supplier_code = _text(supplier.get("id")) or None
    supplier_name = _text(supplier.get("nome")) or None
    combined_names = " / ".join(value for value in (customer_name, supplier_name) if value)
    combined_codes = " / ".join(value for value in (customer_code, supplier_code) if value)
    # Il magazzino della sede ToolTo non viene importato: è una scelta operativa dei
    # Carichi, quindi la riga nasce vuota e la sincronizzazione non tocca quella scelta.
    warehouse = existing.get("warehouse") if existing is not None else None

    row = deepcopy(existing) if existing else {}
    row.update(
        {
            "client_supplier_code": combined_codes or None,
            "client_supplier": combined_names or None,
            "customer_code": customer_code,
            "customer_name": customer_name,
            "supplier_code": supplier_code,
            "supplier_name": supplier_name,
            "inbound_count": 1 if movement == "IN" else 0,
            "outbound_count": 1 if movement == "OUT" else 0,
            "pallet_count": int((existing or {}).get("pallet_count") or 0),
            "notes": _booking_notes(item),
            "warehouse": warehouse,
            "gesap_booking_id": booking_id(item),
            "gesap_booking_date": booking_date(item, fallback_date).isoformat(),
            "gesap_status": _text(item.get("stato")) or None,
            "gesap_locked": True,
        }
    )
    return row


def protect_gesap_rows(existing_rows: list[dict], incoming_rows: list[dict]) -> list[dict]:
    """Accetta pallet e magazzino sulle righe ToolTo e ne impedisce la rimozione manuale."""
    existing_by_id = {row.get("row_id"): row for row in existing_rows if row.get("row_id")}
    incoming_by_id = {row.get("row_id"): row for row in incoming_rows if row.get("row_id")}
    protected_ids = {row_id for row_id, row in existing_by_id.items() if is_gesap_row(row)}

    result: list[dict] = []
    for incoming in incoming_rows:
        row_id = incoming.get("row_id")
        existing = existing_by_id.get(row_id)
        if existing is not None and is_gesap_row(existing):
            protected = deepcopy(existing)
            protected["pallet_count"] = max(0, int(incoming.get("pallet_count") or 0))
            protected["warehouse"] = incoming.get("warehouse") or None
            result.append(protected)
            continue

        clean = deepcopy(incoming)
        if is_gesap_row(clean):
            for field in GESAP_ROW_FIELDS:
                if field.startswith("gesap_") or field in {"customer_code", "customer_name", "supplier_code", "supplier_name"}:
                    clean.pop(field, None)
        result.append(clean)

    received_ids = set(incoming_by_id)
    for row_id in protected_ids - received_ids:
        result.append(deepcopy(existing_by_id[row_id]))
    return result

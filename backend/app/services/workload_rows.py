from datetime import datetime, timezone
from uuid import uuid4

AUDITED_ROW_FIELDS = (
    "client_supplier_code",
    "client_supplier",
    "inbound_count",
    "outbound_count",
    "pallet_count",
    "notes",
    "warehouse",
    "customer_code",
    "customer_name",
    "supplier_code",
    "supplier_name",
    "gesap_booking_id",
    "gesap_booking_date",
    "gesap_status",
)


def _row_snapshot(row: dict) -> dict:
    return {field: row.get(field) for field in AUDITED_ROW_FIELDS}


def _content_key(row: dict) -> tuple:
    return tuple(row.get(field) for field in AUDITED_ROW_FIELDS)


def diff_and_stamp_rows(existing_rows: list[dict], incoming_rows: list[dict], actor_label: str | None) -> list[dict]:
    """Confronta le righe salvate con quelle in arrivo e aggiorna i timbri.

    L'identità di riga è il ``row_id``. Le righe salvate prima dell'introduzione
    del ``row_id`` (dato storico) ne sono prive: per non timbrarle tutte come
    nuove al primo salvataggio, le righe in arrivo senza corrispondenza per
    ``row_id`` vengono abbinate per contenuto a una riga esistente ancora libera;
    se combaciano ereditano il timbro precedente senza essere marcate come
    modificate. Solo le righe realmente nuove o cambiate ricevono il timbro
    dell'utente corrente. I timbri inviati dal client non sono mai attendibili.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    existing_by_id: dict[str, dict] = {}
    legacy_rows: list[dict] = []
    for row in existing_rows:
        if not isinstance(row, dict):
            continue
        if row.get("row_id"):
            existing_by_id[row["row_id"]] = row
        else:
            legacy_rows.append(row)

    # Indice contenuto -> righe legacy ancora abbinabili (multiset per contenuti uguali).
    legacy_by_content: dict[tuple, list[dict]] = {}
    for row in legacy_rows:
        legacy_by_content.setdefault(_content_key(row), []).append(row)

    claimed_ids: set[str] = set()
    claimed_legacy: set[int] = set()
    events: list[dict] = []

    for row in incoming_rows:
        row_id = row.get("row_id")
        existing = existing_by_id.get(row_id) if row_id else None
        if existing is not None:
            claimed_ids.add(row_id)
            changes = {
                field: {"old": existing.get(field), "new": row.get(field)}
                for field in AUDITED_ROW_FIELDS
                if existing.get(field) != row.get(field)
            }
            if changes:
                row["last_modified_by"] = actor_label
                row["last_modified_at"] = now_iso
                events.append({"action": "update_row", "row_id": row_id, "changes": changes})
            else:
                row["last_modified_by"] = existing.get("last_modified_by")
                row["last_modified_at"] = existing.get("last_modified_at")
            continue

        legacy_matches = legacy_by_content.get(_content_key(row))
        if legacy_matches:
            legacy = legacy_matches.pop()
            claimed_legacy.add(id(legacy))
            # Riga storica invariata: le si assegna un'identità stabile senza
            # timbrarla come modificata da chi sta salvando ora.
            row["row_id"] = legacy.get("row_id") or str(uuid4())
            row["last_modified_by"] = legacy.get("last_modified_by")
            row["last_modified_at"] = legacy.get("last_modified_at")
            continue

        # Riga realmente nuova (o modificata rispetto al dato storico).
        row["row_id"] = str(uuid4())
        row["last_modified_by"] = actor_label
        row["last_modified_at"] = now_iso
        events.append({"action": "add_row", "row_id": row["row_id"], "after": _row_snapshot(row)})

    for row_id, existing in existing_by_id.items():
        if row_id not in claimed_ids:
            events.append({"action": "delete_row", "row_id": row_id, "before": _row_snapshot(existing)})
    for row in legacy_rows:
        if id(row) not in claimed_legacy:
            events.append({"action": "delete_row", "row_id": row.get("row_id"), "before": _row_snapshot(row)})

    return events

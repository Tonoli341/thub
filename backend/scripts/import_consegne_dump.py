#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import sys
import unicodedata
import uuid
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

try:
    import psycopg  # type: ignore
except Exception:  # pragma: no cover - fallback for host environments without libpq for psycopg3
    psycopg = None
try:
    import psycopg2  # type: ignore
except Exception:  # pragma: no cover - optional fallback for host environments
    psycopg2 = None


csv.field_size_limit(sys.maxsize)

INSERT_RE = re.compile(r"^INSERT INTO public\.(?P<table>\w+) \((?P<columns>[^)]+)\) VALUES \((?P<values>.*)\);$")
SUPPORTED_TABLES = {
    "employees",
    "equipment_items",
    "equipment_deliveries",
    "size_groups",
    "size_options",
    "equipment_item_sizes",
}


@dataclass
class OldEmployee:
    id: str
    full_name: str


@dataclass
class OldItem:
    id: str
    name: str
    category: str
    notes: str | None
    is_active: bool
    created_at: datetime | None
    updated_at: datetime | None


@dataclass
class OldGroup:
    id: str
    name: str
    sort_order: int


@dataclass
class OldOption:
    id: str
    group_id: str
    value: str
    sort_order: int


@dataclass
class OldDelivery:
    id: str
    employee_id: str
    item_id: str
    item_name: str
    item_category: str
    item_size: str | None
    delivered_by: str | None
    delivered_at: datetime | None
    returned_at: datetime | None
    notes: str | None
    signature_b64: str
    created_at: datetime | None
    updated_at: datetime | None
    quantity: int


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Importa il dump consegne adattandolo agli employees TMS esistenti.")
    parser.add_argument("dump_path", type=Path)
    parser.add_argument("--database-url", default=os.getenv("DATABASE_URL"))
    parser.add_argument("--apply", action="store_true", help="Esegue gli INSERT/UPDATE sul database.")
    parser.add_argument("--limit-deliveries", type=int, default=None, help="Limita il numero di consegne da processare.")
    parser.add_argument(
        "--report-path",
        type=Path,
        default=Path("/tmp/import_consegne_report.json"),
        help="Percorso del report JSON con match, unresolved e conteggi.",
    )
    return parser.parse_args()


def parse_env_database_url(repo_root: Path) -> str | None:
    env_path = repo_root / ".env"
    if not env_path.exists():
        return None
    for line in env_path.read_text(encoding="utf-8").splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in stripped:
            continue
        key, value = stripped.split("=", 1)
        if key.strip() == "DATABASE_URL":
            return value.strip()
    return None


def normalize_name(value: str) -> str:
    normalized = unicodedata.normalize("NFKD", value or "")
    ascii_text = normalized.encode("ascii", "ignore").decode("ascii")
    collapsed = re.sub(r"\s+", " ", ascii_text).strip().lower()
    return collapsed


def token_key(value: str) -> tuple[str, ...]:
    return tuple(sorted(token for token in normalize_name(value).split(" ") if token))


def parse_sql_values(raw_values: str) -> list[Any]:
    reader = csv.reader([raw_values], delimiter=",", quotechar="'", doublequote=True, skipinitialspace=True)
    row = next(reader)
    parsed: list[Any] = []
    for value in row:
        stripped = value.strip()
        if stripped.upper() == "NULL":
            parsed.append(None)
        elif stripped.lower() == "true":
            parsed.append(True)
        elif stripped.lower() == "false":
            parsed.append(False)
        else:
            parsed.append(stripped)
    return parsed


def parse_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    cleaned = str(value).strip()
    try:
        return datetime.fromisoformat(cleaned)
    except ValueError:
        for fmt in ("%Y-%m-%d %H:%M:%S.%f", "%Y-%m-%d %H:%M:%S"):
            try:
                return datetime.strptime(cleaned, fmt)
            except ValueError:
                continue
        raise


def load_dump(dump_path: Path) -> dict[str, Any]:
    old_employees: dict[str, OldEmployee] = {}
    old_items: dict[str, OldItem] = {}
    old_groups: dict[str, OldGroup] = {}
    old_options: dict[str, OldOption] = {}
    old_item_sizes: dict[str, set[str]] = defaultdict(set)
    old_deliveries: list[OldDelivery] = []

    with dump_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            match = INSERT_RE.match(line.rstrip("\n"))
            if not match:
                continue
            table = match.group("table")
            if table not in SUPPORTED_TABLES:
                continue
            columns = [column.strip() for column in match.group("columns").split(",")]
            values = parse_sql_values(match.group("values"))
            if len(columns) != len(values):
                raise ValueError(f"Column/value mismatch for table {table}: {len(columns)} columns vs {len(values)} values")
            record = dict(zip(columns, values))

            if table == "employees":
                old_employees[str(record["id"])] = OldEmployee(
                    id=str(record["id"]),
                    full_name=str(record["full_name"]),
                )
            elif table == "equipment_items":
                old_items[str(record["id"])] = OldItem(
                    id=str(record["id"]),
                    name=str(record["name"]),
                    category=str(record["category"]),
                    notes=record.get("notes"),
                    is_active=bool(record["is_active"]),
                    created_at=parse_timestamp(record.get("created_at")),
                    updated_at=parse_timestamp(record.get("updated_at")),
                )
            elif table == "size_groups":
                old_groups[str(record["id"])] = OldGroup(
                    id=str(record["id"]),
                    name=str(record["name"]),
                    sort_order=int(record["sort_order"]),
                )
            elif table == "size_options":
                old_options[str(record["id"])] = OldOption(
                    id=str(record["id"]),
                    group_id=str(record["group_id"]),
                    value=str(record["value"]),
                    sort_order=int(record["sort_order"]),
                )
            elif table == "equipment_item_sizes":
                old_item_sizes[str(record["item_id"])].add(str(record["size_option_id"]))
            elif table == "equipment_deliveries":
                old_deliveries.append(
                    OldDelivery(
                        id=str(record["id"]),
                        employee_id=str(record["employee_id"]),
                        item_id=str(record["item_id"]),
                        item_name=str(record["item_name"]),
                        item_category=str(record["item_category"]),
                        item_size=record.get("item_size"),
                        delivered_by=record.get("delivered_by"),
                        delivered_at=parse_timestamp(record.get("delivered_at")),
                        returned_at=parse_timestamp(record.get("returned_at")),
                        notes=record.get("notes"),
                        signature_b64=str(record["signature_b64"]),
                        created_at=parse_timestamp(record.get("created_at")),
                        updated_at=parse_timestamp(record.get("updated_at")),
                        quantity=int(record.get("quantity") or 1),
                    )
                )

    return {
        "employees": old_employees,
        "items": old_items,
        "groups": old_groups,
        "options": old_options,
        "item_sizes": old_item_sizes,
        "deliveries": old_deliveries,
    }


def connect(database_url: str):
    if psycopg is not None:
        normalized_url = database_url.replace("postgresql+psycopg://", "postgresql://", 1)
        return psycopg.connect(normalized_url)
    if psycopg2 is None:
        raise RuntimeError("Nessun driver PostgreSQL disponibile: psycopg e psycopg2 non importabili.")
    parsed = urlparse(database_url)
    return psycopg2.connect(
        dbname=(parsed.path or "").lstrip("/"),
        user=parsed.username,
        password=parsed.password,
        host=parsed.hostname,
        port=parsed.port,
    )


def load_current_employees(conn) -> tuple[dict[str, dict[str, Any]], dict[tuple[str, ...], list[dict[str, Any]]]]:
    exact: dict[str, dict[str, Any]] = {}
    by_tokens: dict[tuple[str, ...], list[dict[str, Any]]] = defaultdict(list)
    with conn.cursor() as cur:
        cur.execute("select id, full_name, is_active from employees")
        for employee_id, full_name, is_active in cur.fetchall():
            entry = {"id": employee_id, "full_name": full_name, "is_active": is_active}
            exact[normalize_name(full_name)] = entry
            by_tokens[token_key(full_name)].append(entry)
    return exact, by_tokens


def match_employees(
    old_employees: dict[str, OldEmployee],
    current_exact: dict[str, dict[str, Any]],
    current_tokens: dict[tuple[str, ...], list[dict[str, Any]]],
) -> tuple[dict[str, str], list[tuple[str, str]], list[tuple[str, str, list[str]]]]:
    matched: dict[str, str] = {}
    unresolved: list[tuple[str, str]] = []
    ambiguous: list[tuple[str, str, list[str]]] = []
    for old_id, old_employee in old_employees.items():
        exact = current_exact.get(normalize_name(old_employee.full_name))
        if exact is not None:
            matched[old_id] = exact["id"]
            continue
        candidates = current_tokens.get(token_key(old_employee.full_name), [])
        if len(candidates) == 1:
            matched[old_id] = candidates[0]["id"]
        elif len(candidates) > 1:
            ambiguous.append((old_id, old_employee.full_name, [candidate["full_name"] for candidate in candidates]))
        else:
            unresolved.append((old_id, old_employee.full_name))
    return matched, unresolved, ambiguous


def ensure_group(conn, name: str, sort_order: int) -> str:
    with conn.cursor() as cur:
        cur.execute("select id from size_groups where lower(name) = lower(%s)", (name,))
        row = cur.fetchone()
        if row:
            cur.execute("update size_groups set sort_order = %s where id = %s", (sort_order, row[0]))
            return row[0]
        cur.execute(
            """
            insert into size_groups (id, name, sort_order)
            values (%s, %s, %s)
            returning id
            """,
            (str(uuid.uuid4()), name, sort_order),
        )
        return cur.fetchone()[0]


def ensure_option(conn, group_id: str, value: str, sort_order: int) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "select id from size_options where group_id = %s and lower(value) = lower(%s)",
            (group_id, value),
        )
        row = cur.fetchone()
        if row:
            cur.execute("update size_options set sort_order = %s where id = %s", (sort_order, row[0]))
            return row[0]
        cur.execute(
            """
            insert into size_options (id, group_id, value, sort_order)
            values (%s, %s, %s, %s)
            returning id
            """,
            (str(uuid.uuid4()), group_id, value, sort_order),
        )
        return cur.fetchone()[0]


def ensure_item(conn, item: OldItem) -> str:
    with conn.cursor() as cur:
        cur.execute(
            "select id from equipment_items where lower(name) = lower(%s) and lower(category) = lower(%s) order by created_at asc limit 1",
            (item.name, item.category),
        )
        row = cur.fetchone()
        if row:
            cur.execute(
                """
                update equipment_items
                set notes = coalesce(notes, %s),
                    is_active = %s
                where id = %s
                """,
                (item.notes, item.is_active, row[0]),
            )
            return row[0]
        cur.execute(
            """
            insert into equipment_items (id, name, category, notes, is_active, created_at, updated_at)
            values (%s, %s, %s, %s, %s, %s, %s)
            returning id
            """,
            (
                item.id,
                item.name,
                item.category,
                item.notes,
                item.is_active,
                item.created_at or datetime.utcnow(),
                item.updated_at or item.created_at or datetime.utcnow(),
            ),
        )
        return cur.fetchone()[0]


def attach_item_sizes(conn, item_id: str, size_option_ids: set[str]) -> None:
    with conn.cursor() as cur:
        for option_id in size_option_ids:
            cur.execute(
                """
                insert into equipment_item_sizes (item_id, size_option_id)
                values (%s, %s)
                on conflict do nothing
                """,
                (item_id, option_id),
            )


def delivery_exists(conn, delivery_id: str) -> bool:
    with conn.cursor() as cur:
        cur.execute("select 1 from equipment_deliveries where id = %s", (delivery_id,))
        return cur.fetchone() is not None


def insert_delivery(conn, delivery: OldDelivery, employee_id: str, item_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            """
            insert into equipment_deliveries (
                id, employee_id, item_id, item_name, item_category, item_size, quantity,
                delivered_by, delivered_at, returned_at, notes, signature_b64, created_at, updated_at
            )
            values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                delivery.id,
                employee_id,
                item_id,
                delivery.item_name,
                delivery.item_category,
                delivery.item_size,
                delivery.quantity,
                delivery.delivered_by,
                delivery.delivered_at or datetime.utcnow(),
                delivery.returned_at,
                delivery.notes,
                delivery.signature_b64,
                delivery.created_at or delivery.delivered_at or datetime.utcnow(),
                delivery.updated_at or delivery.created_at or delivery.delivered_at or datetime.utcnow(),
            ),
        )


def maybe_rewrite_db_host(database_url: str) -> str:
    parsed = urlparse(database_url)
    if parsed.hostname != "db":
        return database_url
    host_override = os.getenv("DATABASE_HOST_OVERRIDE")
    if not host_override:
        return database_url
    return database_url.replace("@db:", f"@{host_override}:")


def main() -> int:
    args = parse_args()
    repo_root = Path(__file__).resolve().parents[2]
    database_url = args.database_url or parse_env_database_url(repo_root)
    if not database_url:
        print("DATABASE_URL non disponibile.", file=sys.stderr)
        return 2
    database_url = maybe_rewrite_db_host(database_url)

    dump = load_dump(args.dump_path)
    old_employees: dict[str, OldEmployee] = dump["employees"]
    old_items: dict[str, OldItem] = dump["items"]
    old_groups: dict[str, OldGroup] = dump["groups"]
    old_options: dict[str, OldOption] = dump["options"]
    old_item_sizes: dict[str, set[str]] = dump["item_sizes"]
    old_deliveries: list[OldDelivery] = dump["deliveries"]

    if args.limit_deliveries is not None:
        old_deliveries = old_deliveries[: args.limit_deliveries]

    conn = connect(database_url)
    conn.autocommit = False
    try:
        current_exact, current_tokens = load_current_employees(conn)
        employee_map, unresolved, ambiguous = match_employees(old_employees, current_exact, current_tokens)
        unresolved_delivery_counts: dict[str, int] = defaultdict(int)
        for delivery in old_deliveries:
            if delivery.employee_id not in employee_map:
                unresolved_delivery_counts[delivery.employee_id] += 1

        print(f"old_employees={len(old_employees)} matched={len(employee_map)} unresolved={len(unresolved)} ambiguous={len(ambiguous)}")
        if unresolved:
            print("unresolved sample:")
            for old_id, full_name in unresolved[:20]:
                print(f"  - {old_id}: {full_name}")
        if ambiguous:
            print("ambiguous sample:")
            for old_id, full_name, candidates in ambiguous[:20]:
                print(f"  - {old_id}: {full_name} -> {', '.join(candidates)}")

        group_id_map: dict[str, str] = {}
        option_id_map: dict[str, str] = {}
        item_id_map: dict[str, str] = {}

        for old_group in sorted(old_groups.values(), key=lambda value: (value.sort_order, value.name.lower())):
            if args.apply:
                group_id_map[old_group.id] = ensure_group(conn, old_group.name, old_group.sort_order)
            else:
                group_id_map[old_group.id] = old_group.id

        for old_option in sorted(old_options.values(), key=lambda value: (old_groups[value.group_id].sort_order if value.group_id in old_groups else 9999, value.sort_order, value.value.lower())):
            if args.apply:
                target_group_id = group_id_map[old_option.group_id]
                option_id_map[old_option.id] = ensure_option(conn, target_group_id, old_option.value, old_option.sort_order)
            else:
                option_id_map[old_option.id] = old_option.id

        merged_items = 0
        created_or_reused_items = 0
        for old_item in old_items.values():
            if args.apply:
                target_item_id = ensure_item(conn, old_item)
                created_or_reused_items += 1
                if target_item_id != old_item.id:
                    merged_items += 1
                item_id_map[old_item.id] = target_item_id
                mapped_sizes = {option_id_map[option_id] for option_id in old_item_sizes.get(old_item.id, set()) if option_id in option_id_map}
                attach_item_sizes(conn, target_item_id, mapped_sizes)
            else:
                item_id_map[old_item.id] = old_item.id

        imported_deliveries = 0
        skipped_existing = 0
        skipped_unmatched_employee = 0
        skipped_missing_item = 0
        for delivery in old_deliveries:
            target_employee_id = employee_map.get(delivery.employee_id)
            if target_employee_id is None:
                skipped_unmatched_employee += 1
                continue
            target_item_id = item_id_map.get(delivery.item_id)
            if target_item_id is None:
                skipped_missing_item += 1
                continue
            if args.apply and delivery_exists(conn, delivery.id):
                skipped_existing += 1
                continue
            if args.apply:
                insert_delivery(conn, delivery, target_employee_id, target_item_id)
            imported_deliveries += 1

        if args.apply:
            conn.commit()
        else:
            conn.rollback()

        print(f"items_processed={len(old_items)} items_merged={merged_items} item_sizes_links={sum(len(value) for value in old_item_sizes.values())}")
        print(
            "deliveries_total="
            f"{len(old_deliveries)} deliveries_importable={imported_deliveries} "
            f"skipped_existing={skipped_existing} skipped_unmatched_employee={skipped_unmatched_employee} "
            f"skipped_missing_item={skipped_missing_item}"
        )
        print("mode=apply" if args.apply else "mode=dry-run")

        report = {
            "mode": "apply" if args.apply else "dry-run",
            "old_employees": len(old_employees),
            "matched_employees": len(employee_map),
            "unresolved_employees": [
                {
                    "old_employee_id": old_id,
                    "full_name": full_name,
                    "deliveries_count": unresolved_delivery_counts.get(old_id, 0),
                }
                for old_id, full_name in unresolved
            ],
            "ambiguous_employees": [
                {
                    "old_employee_id": old_id,
                    "full_name": full_name,
                    "candidates": candidates,
                }
                for old_id, full_name, candidates in ambiguous
            ],
            "deliveries": {
                "total": len(old_deliveries),
                "importable": imported_deliveries,
                "skipped_existing": skipped_existing,
                "skipped_unmatched_employee": skipped_unmatched_employee,
                "skipped_missing_item": skipped_missing_item,
            },
        }
        args.report_path.parent.mkdir(parents=True, exist_ok=True)
        args.report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"report_path={args.report_path}")
        return 0
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


if __name__ == "__main__":
    raise SystemExit(main())

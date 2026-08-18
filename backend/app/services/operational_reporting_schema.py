"""Allineamenti idempotenti delle sole tabelle di rendicontazione operativa.

Il progetto crea le tabelle mancanti con ``create_all`` all'avvio, ma questo
non aggiunge colonne a tabelle già presenti. Questo piccolo compat layer evita
che un deploy applicativo precedente ad ``alembic upgrade head`` renda il
modulo indisponibile. Alembic resta la fonte ufficiale della revisione schema.
"""

from sqlalchemy import inspect, text

from app.db import engine


TABLE = "operational_report_allocations"
OLD_CONSTRAINT = "uq_operational_report_block_customer"
NEW_CONSTRAINT = "uq_operational_report_block_customer_jupiter"


def ensure_operational_reporting_schema(bind=engine) -> None:
    inspector = inspect(bind)
    if not inspector.has_table(TABLE):
        return

    columns = {item["name"] for item in inspector.get_columns(TABLE)}
    with bind.begin() as connection:
        if "jupiter_description_snapshot" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN jupiter_description_snapshot TEXT"
            ))
        if "sequence" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN sequence INTEGER NOT NULL DEFAULT 0"
            ))
        if "start_offset_minutes" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN start_offset_minutes INTEGER NOT NULL DEFAULT 0"
            ))
            rows = connection.execute(text(
                "SELECT id, block_id, minutes FROM operational_report_allocations "
                "ORDER BY block_id, sequence, id"
            )).mappings()
            offsets: dict[str, int] = {}
            for row in rows:
                offset = offsets.get(row["block_id"], 0)
                connection.execute(
                    text("UPDATE operational_report_allocations SET start_offset_minutes = :offset WHERE id = :id"),
                    {"offset": offset, "id": row["id"]},
                )
                offsets[row["block_id"]] = offset + int(row["minutes"])
        if "notes" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN notes TEXT"
            ))

        # SQLite è usato soltanto dai test e non supporta DROP CONSTRAINT.
        # Le tabelle nuove create dalla metadata hanno già il vincolo corretto.
        if connection.dialect.name != "postgresql":
            return

        constraints = {
            row[0]
            for row in connection.execute(
                text(
                    "SELECT conname FROM pg_constraint "
                    "WHERE conrelid = 'operational_report_allocations'::regclass "
                    "AND contype = 'u'"
                )
            )
        }
        if OLD_CONSTRAINT in constraints:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "DROP CONSTRAINT uq_operational_report_block_customer"
            ))
        if NEW_CONSTRAINT in constraints:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "DROP CONSTRAINT uq_operational_report_block_customer_jupiter"
            ))

"""Allineamenti idempotenti delle sole tabelle di rendicontazione operativa.

Il progetto crea le tabelle mancanti con ``create_all`` all'avvio, ma questo
non aggiunge colonne a tabelle già presenti. Questo piccolo compat layer evita
che un deploy applicativo precedente ad ``alembic upgrade head`` renda il
modulo indisponibile. Alembic resta la fonte ufficiale della revisione schema.

Come ``ensure_schema_updates`` in ``app.db``, è **congelata dal 2026-08-21**:
le modifiche di schema nuove si scrivono come revisione Alembic, non qui.
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
        # Posizione della singola attività: restano NULL sulle righe già
        # scritte, dove vale ancora la posizione del blocco.
        if "actual_area_id" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN actual_area_id VARCHAR(36)"
            ))
        if "actual_area_name_snapshot" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN actual_area_name_snapshot VARCHAR(120)"
            ))
        if "actual_building" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN actual_building VARCHAR(50)"
            ))
        # Autore e istante di creazione/modifica della singola casella: restano
        # NULL sulle righe scritte prima del tracciamento, perché inventare una
        # data sarebbe peggio che non mostrarne nessuna.
        if "created_by_name" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN created_by_name VARCHAR(120)"
            ))
        # SQLite (solo test) non conosce TIMESTAMPTZ.
        timestamp_type = "TIMESTAMPTZ" if connection.dialect.name == "postgresql" else "TIMESTAMP"
        if "created_at" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                f"ADD COLUMN created_at {timestamp_type}"
            ))
        if "last_modified_by_name" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                "ADD COLUMN last_modified_by_name VARCHAR(120)"
            ))
        if "last_modified_at" not in columns:
            connection.execute(text(
                "ALTER TABLE operational_report_allocations "
                f"ADD COLUMN last_modified_at {timestamp_type}"
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

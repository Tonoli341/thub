"""Indici unique parziali per device_assets.

Converte gli indici legacy su `serial_number` e `ninja_device_id` in indici
unique parziali (`WHERE ... IS NOT NULL`), cosi' i dispositivi senza seriale o
senza collegamento NinjaOne non vanno in conflitto tra loro.

Revision ID: 0003_device_assets_partial_unique_indexes
Revises: 0002_justification_traceability
Create Date: 2026-07-09

"""
import sqlalchemy as sa
from alembic import op

revision = "0003_device_assets_partial_unique_indexes"
down_revision = "0002_justification_traceability"
branch_labels = None
depends_on = None


def _has_duplicates(table_name: str, column_expr: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            f"""
            SELECT 1 FROM {table_name}
            WHERE {column_expr} IS NOT NULL
            GROUP BY {column_expr}
            HAVING COUNT(*) > 1
            LIMIT 1
            """
        )
    ).first()
    return result is not None


def _ensure_partial_unique_index(table_name: str, index_name: str, column_expr: str) -> None:
    bind = op.get_bind()
    desired_predicate = f"WHERE {column_expr} IS NOT NULL"
    constraint_name = bind.execute(
        sa.text(
            """
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE c.contype = 'u'
              AND t.relname = :table_name
              AND c.conname = :index_name
            """
        ),
        {"table_name": table_name, "index_name": index_name},
    ).scalar()
    if constraint_name:
        op.execute(sa.text(f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name}"))

    index_def = bind.execute(
        sa.text("SELECT indexdef FROM pg_indexes WHERE tablename = :table_name AND indexname = :index_name"),
        {"table_name": table_name, "index_name": index_name},
    ).scalar()
    normalized_index_def = " ".join(str(index_def).upper().split()) if index_def else None
    normalized_predicate = " ".join(desired_predicate.upper().split())
    if index_def and normalized_predicate not in normalized_index_def:
        op.execute(sa.text(f"DROP INDEX IF EXISTS {index_name}"))
        index_def = None
    if not index_def:
        # Dati reali possono gia' contenere duplicati (es. seriali NinjaOne non
        # univoci, vedi 0004): in quel caso l'indice unique fallirebbe e
        # bloccherebbe l'intera catena di migrazioni. Meglio degradare a un
        # indice non-unique piuttosto che interrompere l'upgrade.
        unique_clause = "" if _has_duplicates(table_name, column_expr) else "UNIQUE "
        op.execute(
            sa.text(
                f"CREATE {unique_clause}INDEX IF NOT EXISTS {index_name} "
                f"ON {table_name} ({column_expr}) WHERE {column_expr} IS NOT NULL"
            )
        )


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("device_assets"):
        return
    _ensure_partial_unique_index("device_assets", "ix_device_assets_serial_number", "serial_number")
    _ensure_partial_unique_index("device_assets", "ix_device_assets_ninja_device_id", "ninja_device_id")


def downgrade() -> None:
    pass

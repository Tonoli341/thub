"""Seriali device non univoci.

NinjaOne puo' esporre lo stesso seriale su piu' dispositivi distinti
(es. asset duplicati o dati errati lato RMM). Il campo `serial_number`
deve quindi restare indicizzato ma non unique, altrimenti il sync azzera
il seriale o fallisce.

Revision ID: 0004_device_assets_serial_not_unique
Revises: 0003_device_assets_partial_unique_indexes
Create Date: 2026-07-09

"""
import sqlalchemy as sa
from alembic import op

revision = "0004_device_assets_serial_not_unique"
down_revision = "0003_device_assets_partial_unique_indexes"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    index_def = bind.execute(
        sa.text("SELECT indexdef FROM pg_indexes WHERE tablename = 'device_assets' AND indexname = 'ix_device_assets_serial_number'")
    ).scalar()
    if index_def and "UNIQUE" in str(index_def).upper():
        op.execute(sa.text("DROP INDEX IF EXISTS ix_device_assets_serial_number"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_device_assets_serial_number ON device_assets (serial_number)"))


def downgrade() -> None:
    pass

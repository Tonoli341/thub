"""Consegne dispositivi con firma differita.

Permette di creare un'assegnazione dispositivo senza firma immediata; la firma
arriva successivamente dal tablet.

Revision ID: 0005_device_delivery_pending_signature
Revises: 0004_device_assets_serial_not_unique
Create Date: 2026-07-09

"""
import sqlalchemy as sa
from alembic import op

revision = "0005_device_delivery_pending_signature"
down_revision = "0004_device_assets_serial_not_unique"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"]: column for column in inspector.get_columns("device_deliveries")}
    if "signature_b64" in columns and not columns["signature_b64"]["nullable"]:
        op.alter_column("device_deliveries", "signature_b64", existing_type=sa.Text(), nullable=True)


def downgrade() -> None:
    pass

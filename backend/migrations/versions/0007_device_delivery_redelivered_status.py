"""Aggiunge il collegamento per tracciare le consegne riconsegnate.

Revision ID: 0007_device_delivery_redelivered_status
Revises: 0006_justification_decided_by_fk
Create Date: 2026-07-10

"""
import sqlalchemy as sa
from alembic import op

revision = "0007_device_delivery_redelivered_status"
down_revision = "0006_justification_decided_by_fk"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("device_deliveries")}
    if "redelivered_to_delivery_id" not in columns:
        op.add_column("device_deliveries", sa.Column("redelivered_to_delivery_id", sa.String(length=36), nullable=True))
        op.create_index(
            "ix_device_deliveries_redelivered_to_delivery_id",
            "device_deliveries",
            ["redelivered_to_delivery_id"],
            unique=False,
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("device_deliveries")}
    if "redelivered_to_delivery_id" in columns:
        op.drop_index("ix_device_deliveries_redelivered_to_delivery_id", table_name="device_deliveries")
        op.drop_column("device_deliveries", "redelivered_to_delivery_id")

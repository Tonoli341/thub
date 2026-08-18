"""Aggiunge la firma di riconsegna alle consegne dispositivi.

Revision ID: 0008_device_delivery_return_signature
Revises: 0007_device_delivery_redelivered_status
Create Date: 2026-07-10

"""
import sqlalchemy as sa
from alembic import op

revision = "0008_device_delivery_return_signature"
down_revision = "0007_device_delivery_redelivered_status"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("device_deliveries")}
    if "return_requested_at" not in columns:
        op.add_column("device_deliveries", sa.Column("return_requested_at", sa.DateTime(timezone=True), nullable=True))
        op.create_index(
            "ix_device_deliveries_return_requested_at",
            "device_deliveries",
            ["return_requested_at"],
            unique=False,
        )
    if "return_signature_b64" not in columns:
        op.add_column("device_deliveries", sa.Column("return_signature_b64", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("device_deliveries")}
    if "return_signature_b64" in columns:
        op.drop_column("device_deliveries", "return_signature_b64")
    if "return_requested_at" in columns:
        op.drop_index("ix_device_deliveries_return_requested_at", table_name="device_deliveries")
        op.drop_column("device_deliveries", "return_requested_at")

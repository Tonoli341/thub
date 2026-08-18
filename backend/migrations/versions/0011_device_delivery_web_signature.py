"""Firma via web delle consegne dispositivi: fonte firma, data firma e data invito email.

Revision ID: 0011_device_delivery_web_signature
Revises: 0010_active_activities_multi
Create Date: 2026-07-13

"""
import sqlalchemy as sa
from alembic import op

revision = "0011_device_delivery_web_signature"
down_revision = "0010_active_activities_multi"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("device_deliveries")}
    if "signature_source" not in columns:
        op.add_column("device_deliveries", sa.Column("signature_source", sa.String(length=20), nullable=True))
        # Le firme esistenti sono state raccolte tutte dall'app tablet.
        op.execute("UPDATE device_deliveries SET signature_source = 'tablet' WHERE signature_b64 IS NOT NULL")
    if "signed_at" not in columns:
        op.add_column("device_deliveries", sa.Column("signed_at", sa.DateTime(timezone=True), nullable=True))
    if "signature_requested_at" not in columns:
        op.add_column("device_deliveries", sa.Column("signature_requested_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("device_deliveries")}
    if "signature_requested_at" in columns:
        op.drop_column("device_deliveries", "signature_requested_at")
    if "signed_at" in columns:
        op.drop_column("device_deliveries", "signed_at")
    if "signature_source" in columns:
        op.drop_column("device_deliveries", "signature_source")

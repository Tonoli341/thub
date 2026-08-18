"""Policy di consegna dispositivi IT (Information Security) da leggere prima della firma.

Revision ID: 0012_device_delivery_policy
Revises: 0011_device_delivery_web_signature
Create Date: 2026-07-13

"""
import sqlalchemy as sa
from alembic import op

revision = "0012_device_delivery_policy"
down_revision = "0011_device_delivery_web_signature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("device_delivery_policies"):
        op.create_table(
            "device_delivery_policies",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("content_html", sa.Text(), nullable=False),
            sa.Column("updated_by", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("device_delivery_policies"):
        op.drop_table("device_delivery_policies")

"""Ordine persistente dei box di rendicontazione.

Revision ID: 0019_operational_reporting_sequence
Revises: 0018_operational_reporting_jupiter
Create Date: 2026-08-13
"""

import sqlalchemy as sa
from alembic import op


revision = "0019_operational_reporting_sequence"
down_revision = "0018_operational_reporting_jupiter"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    if "sequence" not in columns:
        op.add_column(
            "operational_report_allocations",
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("operational_report_allocations"):
        columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
        if "sequence" in columns:
            op.drop_column("operational_report_allocations", "sequence")

"""Note associate ai singoli box di rendicontazione.

Revision ID: 0023_reporting_allocation_notes
Revises: 0022_merge_reporting_absence
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from alembic import op


revision = "0023_reporting_allocation_notes"
down_revision = "0022_merge_reporting_absence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    if "notes" not in columns:
        op.add_column("operational_report_allocations", sa.Column("notes", sa.Text(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    if "notes" in columns:
        op.drop_column("operational_report_allocations", "notes")

"""Tracciamento ultima modifica e prima copia del Planner.

Revision ID: 0029_planner_audit
Revises: 0028_reporting_allocation_location
Create Date: 2026-08-18
"""

import sqlalchemy as sa
from alembic import op


revision = "0029_planner_audit"
down_revision = "0028_reporting_allocation_location"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("assignments"):
        columns = {item["name"] for item in inspector.get_columns("assignments")}
        if "last_modified_by_name" not in columns:
            op.add_column("assignments", sa.Column("last_modified_by_name", sa.String(length=120), nullable=True))

    if not inspector.has_table("planner_day_audits"):
        op.create_table(
            "planner_day_audits",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("first_copied_from_date", sa.Date(), nullable=True),
            sa.Column("first_copied_by_name", sa.String(length=120), nullable=True),
            sa.Column("first_copied_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("last_modified_by_name", sa.String(length=120), nullable=True),
            sa.Column("last_modified_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("work_date"),
        )
def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("planner_day_audits"):
        op.drop_table("planner_day_audits")
    if inspector.has_table("assignments"):
        columns = {item["name"] for item in inspector.get_columns("assignments")}
        if "last_modified_by_name" in columns:
            op.drop_column("assignments", "last_modified_by_name")

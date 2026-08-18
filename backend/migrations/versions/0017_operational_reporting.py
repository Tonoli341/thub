"""Rendicontazione operativa derivata dal Planner.

Revision ID: 0017_operational_reporting
Revises: 0016_employee_expirations_scope
Create Date: 2026-08-13
"""

import sqlalchemy as sa
from alembic import op


revision = "0017_operational_reporting"
down_revision = "0016_employee_expirations_scope"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_days"):
        op.create_table(
            "operational_report_days",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("employee_id", sa.String(36), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column("work_date", sa.Date(), nullable=False),
            sa.Column("team_id", sa.String(36), sa.ForeignKey("teams.id"), nullable=False),
            sa.Column("employee_name_snapshot", sa.String(255), nullable=False),
            sa.Column("team_name_snapshot", sa.String(120), nullable=False),
            sa.Column("planned_start", sa.Time(), nullable=False),
            sa.Column("planned_end", sa.Time(), nullable=False),
            sa.Column("actual_start", sa.Time(), nullable=False),
            sa.Column("actual_end", sa.Time(), nullable=False),
            sa.Column("pauses", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("planner_snapshot", sa.JSON(), nullable=False, server_default="[]"),
            sa.Column("status", sa.String(16), nullable=False, server_default="DRAFT"),
            sa.Column("notes", sa.Text()),
            sa.Column("confirmed_at", sa.DateTime(timezone=True)),
            sa.Column("confirmed_by_user_id", sa.String(36), sa.ForeignKey("users.id")),
            sa.Column("last_modified_by_user_id", sa.String(36), sa.ForeignKey("users.id")),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("employee_id", "work_date", name="uq_operational_report_employee_date"),
        )
        op.create_index("ix_operational_report_days_employee_id", "operational_report_days", ["employee_id"])
        op.create_index("ix_operational_report_days_work_date", "operational_report_days", ["work_date"])
        op.create_index("ix_operational_report_days_team_id", "operational_report_days", ["team_id"])

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_blocks"):
        op.create_table(
            "operational_report_blocks",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("day_id", sa.String(36), sa.ForeignKey("operational_report_days.id", ondelete="CASCADE"), nullable=False),
            sa.Column("source_assignment_id", sa.String(36)),
            sa.Column("sequence", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("planned_start", sa.Time(), nullable=False),
            sa.Column("planned_end", sa.Time(), nullable=False),
            sa.Column("planned_break_minutes", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("planned_area", sa.String(120)),
            sa.Column("planned_building", sa.String(50)),
            sa.Column("actual_area_id", sa.String(36)),
            sa.Column("actual_area_name_snapshot", sa.String(120)),
            sa.Column("actual_building", sa.String(50)),
            sa.Column("notes", sa.Text()),
        )
        op.create_index("ix_operational_report_blocks_day_id", "operational_report_blocks", ["day_id"])
        op.create_index("ix_operational_report_blocks_source_assignment_id", "operational_report_blocks", ["source_assignment_id"])
        op.create_index("ix_operational_report_blocks_actual_area_id", "operational_report_blocks", ["actual_area_id"])

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_allocations"):
        op.create_table(
            "operational_report_allocations",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("block_id", sa.String(36), sa.ForeignKey("operational_report_blocks.id", ondelete="CASCADE"), nullable=False),
            sa.Column("customer_code", sa.String(64), nullable=False),
            sa.Column("customer_description_snapshot", sa.String(160), nullable=False),
            sa.Column("minutes", sa.Integer(), nullable=False),
            sa.Column("eligible_mapping_ids", sa.JSON(), nullable=False, server_default="[]"),
            sa.UniqueConstraint("block_id", "customer_code", name="uq_operational_report_block_customer"),
        )
        op.create_index("ix_operational_report_allocations_block_id", "operational_report_allocations", ["block_id"])
        op.create_index("ix_operational_report_allocations_customer_code", "operational_report_allocations", ["customer_code"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("operational_report_allocations"):
        op.drop_table("operational_report_allocations")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("operational_report_blocks"):
        op.drop_table("operational_report_blocks")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("operational_report_days"):
        op.drop_table("operational_report_days")

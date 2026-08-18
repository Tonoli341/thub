"""Data generale di aggiornamento dei residui.

Revision ID: 0021_absence_balance_status
Revises: 0020_operational_reporting_position
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from alembic import op


revision = "0021_absence_balance_status"
down_revision = "0020_operational_reporting_position"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("employee_absence_balance_status"):
        op.create_table(
            "employee_absence_balance_status",
            sa.Column("id", sa.Integer(), nullable=False),
            sa.Column("updated_through", sa.Date(), nullable=True),
            sa.Column("updated_by_user_id", sa.String(length=36), nullable=True),
            sa.Column("updated_by_name", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    if sa.inspect(op.get_bind()).has_table("employee_absence_balance_status"):
        op.drop_table("employee_absence_balance_status")

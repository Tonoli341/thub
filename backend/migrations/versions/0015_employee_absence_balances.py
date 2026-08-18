"""Residui ferie e permessi dei dipendenti.

Revision ID: 0015_employee_absence_balances
Revises: 0014_field_definition_config
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op


revision = "0015_employee_absence_balances"
down_revision = "0014_field_definition_config"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    employee_columns = {col["name"] for col in inspector.get_columns("employees")}
    if "absence_can_edit_balances" not in employee_columns:
        op.add_column(
            "employees",
            sa.Column("absence_can_edit_balances", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    if not inspector.has_table("employee_absence_balances"):
        op.create_table(
            "employee_absence_balances",
            sa.Column("employee_id", sa.String(length=36), nullable=False),
            sa.Column("permission_hours", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("vacation_days", sa.Numeric(10, 2), nullable=False, server_default="0"),
            sa.Column("updated_by_user_id", sa.String(length=36), nullable=True),
            sa.Column("updated_by_name", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.ForeignKeyConstraint(["employee_id"], ["employees.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["updated_by_user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("employee_id"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if inspector.has_table("employee_absence_balances"):
        op.drop_table("employee_absence_balances")

    employee_columns = {col["name"] for col in inspector.get_columns("employees")}
    if "absence_can_edit_balances" in employee_columns:
        op.drop_column("employees", "absence_can_edit_balances")

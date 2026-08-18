"""Ambito di visibilità delle scadenze dipendenti.

Revision ID: 0016_employee_expirations_scope
Revises: 0015_employee_absence_balances
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op


revision = "0016_employee_expirations_scope"
down_revision = "0015_employee_absence_balances"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("employees")}
    if "config_expirations_scope" not in columns:
        op.add_column(
            "employees",
            sa.Column("config_expirations_scope", sa.String(length=16), nullable=False, server_default="all"),
        )
        op.execute(
            "UPDATE employees SET config_expirations_scope = "
            "CASE WHEN config_can_access_expirations THEN 'all' ELSE 'none' END"
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("employees")}
    if "config_expirations_scope" in columns:
        op.drop_column("employees", "config_expirations_scope")

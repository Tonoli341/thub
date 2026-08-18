"""Permesso dedicato per la sezione Consegne.

Aggiunge il toggle per-dipendente config_can_access_deliveries: la voce di
menu Consegne non dipende piu' dall'accesso organizzazione ma da questo
permesso (admin e HR sempre abilitati).

Revision ID: 0009_employee_deliveries_access
Revises: 0008_device_delivery_return_signature
Create Date: 2026-07-10

"""
import sqlalchemy as sa
from alembic import op

revision = "0009_employee_deliveries_access"
down_revision = "0008_device_delivery_return_signature"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("employees")}
    if "config_can_access_deliveries" not in columns:
        op.add_column(
            "employees",
            sa.Column("config_can_access_deliveries", sa.Boolean(), nullable=False, server_default=sa.false()),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {column["name"] for column in inspector.get_columns("employees")}
    if "config_can_access_deliveries" in columns:
        op.drop_column("employees", "config_can_access_deliveries")

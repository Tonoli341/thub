"""Owner dedicato per la rendicontazione operativa delle squadre.

Revision ID: 0024_team_reporting_owner
Revises: 0023_reporting_allocation_notes
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from alembic import op


revision = "0024_team_reporting_owner"
down_revision = "0023_reporting_allocation_notes"
branch_labels = None
depends_on = None


COLUMN = "operational_reporting_owner_employee_id"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("teams"):
        return
    columns = {item["name"] for item in inspector.get_columns("teams")}
    if COLUMN not in columns:
        op.add_column(
            "teams",
            sa.Column(COLUMN, sa.String(length=36), sa.ForeignKey("employees.id"), nullable=True),
        )
    op.execute(sa.text(
        "UPDATE teams SET operational_reporting_owner_employee_id = reports_to_employee_id "
        "WHERE operational_reporting_owner_employee_id IS NULL"
    ))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("teams"):
        columns = {item["name"] for item in inspector.get_columns("teams")}
        if COLUMN in columns:
            op.drop_column("teams", COLUMN)

"""Flag notifiche per l'owner della rendicontazione operativa.

Revision ID: 0025_team_reporting_notifications
Revises: 0024_team_reporting_owner
Create Date: 2026-08-18
"""

import sqlalchemy as sa
from alembic import op


revision = "0025_team_reporting_notifications"
down_revision = "0024_team_reporting_owner"
branch_labels = None
depends_on = None


COLUMN = "operational_reporting_notifications_enabled"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("teams"):
        return
    columns = {item["name"] for item in inspector.get_columns("teams")}
    if COLUMN not in columns:
        op.add_column(
            "teams",
            sa.Column(COLUMN, sa.Boolean(), nullable=False, server_default=sa.text("false")),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("teams"):
        columns = {item["name"] for item in inspector.get_columns("teams")}
        if COLUMN in columns:
            op.drop_column("teams", COLUMN)

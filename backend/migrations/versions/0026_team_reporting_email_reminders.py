"""Promemoria email per la rendicontazione operativa delle squadre.

Revision ID: 0026_team_reporting_email_reminders
Revises: 0025_team_reporting_notifications
Create Date: 2026-08-18
"""

import sqlalchemy as sa
from alembic import op


revision = "0026_team_reporting_email_reminders"
down_revision = "0025_team_reporting_notifications"
branch_labels = None
depends_on = None


EMAIL_ENABLED_COLUMN = "operational_reporting_email_enabled"
LAST_EMAIL_DATE_COLUMN = "operational_reporting_last_email_date"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("teams"):
        return
    columns = {item["name"] for item in inspector.get_columns("teams")}
    if EMAIL_ENABLED_COLUMN not in columns:
        op.add_column(
            "teams",
            sa.Column(
                EMAIL_ENABLED_COLUMN,
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("false"),
            ),
        )
    if LAST_EMAIL_DATE_COLUMN not in columns:
        op.add_column("teams", sa.Column(LAST_EMAIL_DATE_COLUMN, sa.Date(), nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("teams"):
        return
    columns = {item["name"] for item in inspector.get_columns("teams")}
    if LAST_EMAIL_DATE_COLUMN in columns:
        op.drop_column("teams", LAST_EMAIL_DATE_COLUMN)
    if EMAIL_ENABLED_COLUMN in columns:
        op.drop_column("teams", EMAIL_ENABLED_COLUMN)

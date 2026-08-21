"""Questionario iniziale e permesso del modulo manutenzioni.

Revision ID: 0027_maintenance_questionnaire
Revises: 0026_team_reporting_email_reminders
Create Date: 2026-08-18
"""

import sqlalchemy as sa
from alembic import op


revision = "0027_maintenance_questionnaire"
down_revision = "0026_team_reporting_email_reminders"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("employees"):
        columns = {item["name"] for item in inspector.get_columns("employees")}
        if "config_can_access_maintenance" not in columns:
            op.add_column(
                "employees",
                sa.Column(
                    "config_can_access_maintenance",
                    sa.Boolean(),
                    nullable=False,
                    server_default=sa.text("false"),
                ),
            )

    if not inspector.has_table("maintenance_questionnaires"):
        op.create_table(
            "maintenance_questionnaires",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("answers", sa.JSON(), server_default=sa.text("'{}'"), nullable=False),
            sa.Column("version", sa.Integer(), nullable=False),
            sa.Column("updated_by", sa.String(length=120), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.PrimaryKeyConstraint("id"),
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("maintenance_questionnaires"):
        op.drop_table("maintenance_questionnaires")
    if inspector.has_table("employees"):
        columns = {item["name"] for item in inspector.get_columns("employees")}
        if "config_can_access_maintenance" in columns:
            op.drop_column("employees", "config_can_access_maintenance")

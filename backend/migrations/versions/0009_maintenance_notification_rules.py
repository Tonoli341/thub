"""Configurazione dei destinatari email per scadenza (§10/§15): tabella
maintenance_notification_rules (classe di asset + sito, opzionali, -> lista
di LdapEmployee da avvisare) e colonna di dedup su maintenance_deadlines per
non rimandare la stessa email più volte lo stesso giorno.

Migrazione additiva: una tabella nuova più un ALTER additivo, coerenti con lo
schema esistente del modulo (0004-0008).

Revision ID: 0009_maintenance_notification_rules
Revises: 0008_maintenance_asset_type_icon
Create Date: 2026-08-31
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0009_maintenance_notification_rules"
down_revision = "0008_maintenance_asset_type_icon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    deadline_columns = {col["name"] for col in inspector.get_columns("maintenance_deadlines")}
    if "last_notice_email_date" not in deadline_columns:
        op.add_column("maintenance_deadlines", sa.Column("last_notice_email_date", sa.Date()))

    if not inspector.has_table("maintenance_notification_rules"):
        op.create_table(
            "maintenance_notification_rules",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("asset_class_id", sa.String(36), sa.ForeignKey("maintenance_asset_classes.id")),
            sa.Column("site", sa.String(120)),
            sa.Column("recipient_ldap_employee_ids", JSONB, nullable=False, server_default="[]"),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("maintenance_notification_rules"):
        op.drop_table("maintenance_notification_rules")

    deadline_columns = {col["name"] for col in inspector.get_columns("maintenance_deadlines")}
    if "last_notice_email_date" in deadline_columns:
        op.drop_column("maintenance_deadlines", "last_notice_email_date")

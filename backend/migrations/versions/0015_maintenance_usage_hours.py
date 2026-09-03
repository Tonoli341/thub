"""Scadenze a soglia ore contaore, oltre a quelle a data (manutenzioni.md
riga 112, punto lasciato esplicitamente aperto): MaintenanceAssetType
acquisisce tracks_usage_hours per marcare quali sottoclassi hanno un
contaore significativo, MaintenanceDeadline acquisisce due_hours/
recurrence_hours/last_completed_hours per le scadenze che usano quella
soglia. La proiezione della data di superamento si calcola al volo dalle
letture già presenti in maintenance_asset_counters, nessuna nuova tabella.

Migrazione additiva: tre colonne nullable/con default, nessun backfill.

Revision ID: 0015_maintenance_usage_hours
Revises: 0014_maintenance_class_employee_fields
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op

revision = "0015_maintenance_usage_hours"
down_revision = "0014_maintenance_class_employee_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    type_columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "tracks_usage_hours" not in type_columns:
        op.add_column(
            "maintenance_asset_types",
            sa.Column("tracks_usage_hours", sa.Boolean(), nullable=False, server_default=sa.false()),
        )

    deadline_columns = {col["name"] for col in inspector.get_columns("maintenance_deadlines")}
    if "due_hours" not in deadline_columns:
        op.add_column("maintenance_deadlines", sa.Column("due_hours", sa.Numeric(12, 2)))
    if "recurrence_hours" not in deadline_columns:
        op.add_column("maintenance_deadlines", sa.Column("recurrence_hours", sa.Integer()))
    if "last_completed_hours" not in deadline_columns:
        op.add_column("maintenance_deadlines", sa.Column("last_completed_hours", sa.Numeric(12, 2)))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    deadline_columns = {col["name"] for col in inspector.get_columns("maintenance_deadlines")}
    for column in ("last_completed_hours", "recurrence_hours", "due_hours"):
        if column in deadline_columns:
            op.drop_column("maintenance_deadlines", column)

    type_columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "tracks_usage_hours" in type_columns:
        op.drop_column("maintenance_asset_types", "tracks_usage_hours")

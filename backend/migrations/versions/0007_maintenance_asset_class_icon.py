"""Aggiunge l'icona personalizzabile alla categoria di asset (usata nella voce
di menu generata dinamicamente in sidebar, vedi App.jsx SidebarNav).

Additiva: colonna nullable=False con default lato server, quindi non richiede
un valore per le righe già esistenti.

Revision ID: 0007_maintenance_asset_class_icon
Revises: 0006_maintenance_field_type_image
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from alembic import op

revision = "0007_maintenance_asset_class_icon"
down_revision = "0006_maintenance_field_type_image"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_classes")}
    if "icon" not in columns:
        op.add_column(
            "maintenance_asset_classes",
            sa.Column("icon", sa.String(40), nullable=False, server_default="tools"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_classes")}
    if "icon" in columns:
        op.drop_column("maintenance_asset_classes", "icon")

"""Aggiunge l'icona personalizzabile anche alla tipologia di asset (oltre
alla categoria, vedi 0007): stesso meccanismo, colonna additiva con default
lato server.

Revision ID: 0008_maintenance_asset_type_icon
Revises: 0007_maintenance_asset_class_icon
Create Date: 2026-08-28
"""

import sqlalchemy as sa
from alembic import op

revision = "0008_maintenance_asset_type_icon"
down_revision = "0007_maintenance_asset_class_icon"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "icon" not in columns:
        op.add_column(
            "maintenance_asset_types",
            sa.Column("icon", sa.String(40), nullable=False, server_default="tools"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "icon" in columns:
        op.drop_column("maintenance_asset_types", "icon")

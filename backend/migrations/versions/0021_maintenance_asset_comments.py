"""Commenti/note multiple nel tempo su un asset del modulo Manutenzioni.

A differenza di `status_reason` (un campo unico sovrascritto a ogni cambio
stato) e di `maintenance_asset_history` (motivo registrato solo quando un
campo tracciato cambia valore), questa tabella permette di annotare l'asset
in qualunque momento, anche restando nello stesso stato. Append-only: nessuna
modifica o cancellazione prevista dalla UI.

Le colonne `status`/`status_reason` sono uno snapshot dello stato dell'asset
al momento della nota, valorizzato dal server: la nota resta leggibile nel
contesto in cui è stata scritta anche se lo stato dell'asset cambia dopo.

Revision ID: 0021_maintenance_asset_comments
Revises: 0020_maintenance_asset_qr_token
Create Date: 2026-09-03
"""

import sqlalchemy as sa
from alembic import op

revision = "0021_maintenance_asset_comments"
down_revision = "0020_maintenance_asset_qr_token"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if "maintenance_asset_comments" not in inspector.get_table_names():
        op.create_table(
            "maintenance_asset_comments",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("asset_id", sa.String(length=36), sa.ForeignKey("maintenance_assets.id"), nullable=False),
            sa.Column("text", sa.Text(), nullable=False),
            sa.Column(
                "status",
                sa.Enum(
                    "attivo", "in_manutenzione", "dismesso", "fuori_servizio",
                    name="maintenance_asset_status",
                    create_type=False,
                ),
                nullable=False,
            ),
            sa.Column("status_reason", sa.String(length=255)),
            sa.Column("created_by", sa.String(length=120)),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index(
            "ix_maintenance_asset_comments_asset_id",
            "maintenance_asset_comments",
            ["asset_id"],
        )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_maintenance_asset_comments_asset_id")
    op.execute("DROP TABLE IF EXISTS maintenance_asset_comments")

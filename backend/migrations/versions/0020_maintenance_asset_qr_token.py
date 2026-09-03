"""Token QR per asset del modulo Manutenzioni.

Colonna `qr_token` su maintenance_assets: nullable, generata solo su richiesta
di un admin (endpoint di rigenerazione), non popolata da questa migrazione.
Permanente ma rigenerabile — rigenerare invalida il token precedente perché
il valore vecchio viene sovrascritto, non c'è storicizzazione dei token usati.

Revision ID: 0020_maintenance_asset_qr_token
Revises: 0019_maintenance_asset_images
Create Date: 2026-09-03
"""

import sqlalchemy as sa
from alembic import op

revision = "0020_maintenance_asset_qr_token"
down_revision = "0019_maintenance_asset_images"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if "qr_token" not in columns:
        op.add_column("maintenance_assets", sa.Column("qr_token", sa.String(length=64), nullable=True))
    op.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_maintenance_assets_qr_token "
        "ON maintenance_assets (qr_token)"
    )


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS uq_maintenance_assets_qr_token")
    inspector = sa.inspect(op.get_bind())
    columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if "qr_token" in columns:
        op.drop_column("maintenance_assets", "qr_token")

"""Separa le immagini anagrafiche dai documenti di manutenzione.

Foto principale, campi tecnici e galleria vengono salvati su SMB ma hanno
metadati propri, senza stato/versione del ciclo documentale. Gli allegati
precedenti sono dichiarati sacrificabili: la revisione non li copia e non li
cancella, così resta additiva e non esegue operazioni distruttive.

Revision ID: 0019_maintenance_asset_images
Revises: 0018_maintenance_asset_photos
Create Date: 2026-09-02
"""

import sqlalchemy as sa
from alembic import op

revision = "0019_maintenance_asset_images"
down_revision = "0018_maintenance_asset_photos"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("maintenance_asset_images"):
        op.create_table(
            "maintenance_asset_images",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("asset_id", sa.String(length=36), sa.ForeignKey("maintenance_assets.id"), nullable=False),
            sa.Column("image_kind", sa.String(length=20), nullable=False),
            sa.Column("slot_key", sa.String(length=80), nullable=False),
            sa.Column("title", sa.String(length=200), nullable=False),
            sa.Column("file_path", sa.String(length=400), nullable=False),
            sa.Column("original_filename", sa.String(length=255), nullable=False),
            sa.Column("mime_type", sa.String(length=120), nullable=False),
            sa.Column("size_bytes", sa.Integer(), nullable=False),
            sa.Column("uploaded_by", sa.String(length=120), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.CheckConstraint(
                "image_kind IN ('main', 'technical', 'gallery')",
                name="ck_maintenance_asset_image_kind",
            ),
            sa.UniqueConstraint("asset_id", "image_kind", "slot_key", name="uq_maintenance_asset_image_slot"),
        )
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_maintenance_asset_images_asset_id "
        "ON maintenance_asset_images (asset_id)"
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("maintenance_asset_images"):
        op.drop_table("maintenance_asset_images")

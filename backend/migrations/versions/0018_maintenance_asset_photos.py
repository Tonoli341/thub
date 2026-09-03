"""Modulo Manutenzioni: foto di anagrafica separate dai documenti.

Aggiunge maintenance_documents.is_photo (bool, default False — i documenti
esistenti restano documenti) e maintenance_assets.main_image_document_id
(FK nullable verso maintenance_documents, la foto di copertina dell'asset).
Additiva, nessun dato esistente tocca.

Revision ID: 0018_maintenance_asset_photos
Revises: 0017_maintenance_deadline_types
Create Date: 2026-09-02
"""

import sqlalchemy as sa
from alembic import op

revision = "0018_maintenance_asset_photos"
down_revision = "0017_maintenance_deadline_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    document_columns = {col["name"] for col in inspector.get_columns("maintenance_documents")}
    if "is_photo" not in document_columns:
        op.add_column(
            "maintenance_documents",
            sa.Column("is_photo", sa.Boolean(), nullable=False, server_default="false"),
        )

    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if "main_image_document_id" not in asset_columns:
        op.add_column(
            "maintenance_assets",
            sa.Column("main_image_document_id", sa.String(length=36), nullable=True),
        )
        op.create_foreign_key(
            "fk_maintenance_assets_main_image_document_id",
            "maintenance_assets",
            "maintenance_documents",
            ["main_image_document_id"],
            ["id"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if "main_image_document_id" in asset_columns:
        op.drop_constraint("fk_maintenance_assets_main_image_document_id", "maintenance_assets", type_="foreignkey")
        op.drop_column("maintenance_assets", "main_image_document_id")

    document_columns = {col["name"] for col in inspector.get_columns("maintenance_documents")}
    if "is_photo" in document_columns:
        op.drop_column("maintenance_documents", "is_photo")

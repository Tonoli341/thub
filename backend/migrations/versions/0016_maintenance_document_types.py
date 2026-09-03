"""Modulo Manutenzioni: value list dei tipi documento, a livello di sottoclasse.

MaintenanceDocument.doc_type era testo libero: aggiunge
maintenance_asset_types.document_type_options (JSON di stringhe) come lista
chiusa di valori ammessi in upload — stessa natura di
MaintenanceAssetField.options per i campi di tipo "elenco", non una tabella
dedicata: non condivisa tra sottoclassi diverse (i documenti richiesti da un
carrello elevatore non sono quelli di una scala portatile), editata da Admin
come testo separato da virgole nella pagina /manutenzioni/categorie. Non
tocca MaintenanceDocument.doc_type (resta stringa): la validazione contro la
lista avviene in services/maintenance_documents.upload_document.

Nota 2026-09-01: prima versione di questa revisione creava una tabella
dedicata maintenance_document_types con CRUD proprio; sostituita da un
semplice campo JSON dopo revisione con l'utente, più coerente con il pattern
già in uso per le opzioni degli attributi "elenco". Se un ambiente ha già
applicato la vecchia forma (tabella maintenance_document_types), questa
revisione la rimuove: non era mai stata raggiungibile dalla UI, nessun dato.

Revision ID: 0016_maintenance_document_types
Revises: 0015_maintenance_usage_hours
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0016_maintenance_document_types"
down_revision = "0015_maintenance_usage_hours"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("maintenance_document_types"):
        op.drop_table("maintenance_document_types")

    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "document_type_options" not in columns:
        op.add_column(
            "maintenance_asset_types",
            sa.Column("document_type_options", JSONB, nullable=False, server_default="[]"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "document_type_options" in columns:
        op.drop_column("maintenance_asset_types", "document_type_options")

"""Modulo Manutenzioni: value list dei tipi scadenza, a livello di sottoclasse.

Stessa logica di 0016_maintenance_document_types: aggiunge
maintenance_asset_types.deadline_type_options (JSON di stringhe) come lista
chiusa di valori ammessi in creazione scadenza. Non tocca
MaintenanceDeadline.deadline_type (resta stringa): la validazione contro la
lista avviene in services/maintenance_deadlines.create_deadline.

Nota 2026-09-01: prima versione di questa revisione creava una tabella
dedicata maintenance_deadline_types con CRUD proprio; sostituita da un
semplice campo JSON dopo revisione con l'utente (vedi 0016). Se un ambiente
ha già applicato la vecchia forma, questa revisione la rimuove: non era mai
stata raggiungibile dalla UI, nessun dato.

Revision ID: 0017_maintenance_deadline_types
Revises: 0016_maintenance_document_types
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0017_maintenance_deadline_types"
down_revision = "0016_maintenance_document_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("maintenance_deadline_types"):
        op.drop_table("maintenance_deadline_types")

    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "deadline_type_options" not in columns:
        op.add_column(
            "maintenance_asset_types",
            sa.Column("deadline_type_options", JSONB, nullable=False, server_default="[]"),
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_types")}
    if "deadline_type_options" in columns:
        op.drop_column("maintenance_asset_types", "deadline_type_options")

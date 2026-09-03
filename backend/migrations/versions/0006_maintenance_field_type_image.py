"""Aggiunge il valore 'image' all'enum maintenance_field_type (attributi di
tipo immagine, es. fotografia della tabella di portata).

Stesso caso della 0002/0003_lowercase: ``ALTER TYPE ... ADD VALUE`` su un enum
nativo Postgres, ammesso dentro una transazione a patto di non usare il
valore nuovo nella stessa transazione — questa revisione non lo usa.

Revision ID: 0006_maintenance_field_type_image
Revises: 0005_maintenance_asset_types
Create Date: 2026-08-28
"""

from alembic import op

revision = "0006_maintenance_field_type_image"
down_revision = "0005_maintenance_asset_types"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TYPE maintenance_field_type ADD VALUE IF NOT EXISTS 'image'")


def downgrade() -> None:
    # Postgres non sa rimuovere un valore da un enum: servirebbe ricreare il tipo
    # e riscrivere la colonna su dati reali. Il valore resta inerte se inutilizzato.
    pass

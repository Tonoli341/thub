"""Nuova causale VISITA_IDONEITA sulle assegnazioni del Planner.

``assignment_cause`` è un enum nativo Postgres: ``create_all`` non aggiunge
valori a un tipo che esiste già, quindi il valore va introdotto qui.
Su Postgres 12+ ``ADD VALUE`` è ammesso dentro una transazione a patto di non
usare il valore nuovo nella stessa transazione — questa revisione non lo usa.
Sui dialetti senza enum nativo (SQLite dei test) non c'è nulla da fare.

Revision ID: 0031_assignment_cause_visita_idoneita
Revises: 0030_reporting_allocation_audit
Create Date: 2026-08-21
"""

from alembic import op


revision = "0031_assignment_cause_visita_idoneita"
down_revision = "0030_reporting_allocation_audit"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TYPE assignment_cause ADD VALUE IF NOT EXISTS 'VISITA_IDONEITA'")


def downgrade() -> None:
    # Postgres non sa rimuovere un valore da un enum: servirebbe ricreare il tipo
    # e riscrivere la colonna su dati reali. Il valore resta inerte se inutilizzato.
    pass

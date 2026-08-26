"""Corregge il valore enum per la causale visita idoneità.

La revisione 0002 aveva aggiunto 'VISITA_IDONEITA' (il ``.value`` del membro
Python) al tipo Postgres ``assignment_cause``. La colonna è mappata con
``Enum(AssignmentCause, name="assignment_cause")`` senza ``values_callable``:
per default SQLAlchemy serializza gli enum PEP-435 usando ``.name``, non
``.value`` — infatti le altre etichette già presenti nel tipo sono
``presence``, ``ferie``, ``permesso``, ``malattia``, ``formazione``,
``trasferta``, ``altro`` (tutte in stile ``.name`` minuscolo). Il valore
giusto da aggiungere è quindi ``visita_idoneita``, non ``VISITA_IDONEITA``.

L'etichetta maiuscola introdotta dalla 0002 resta nel tipo (Postgres non
supporta la rimozione di un valore enum) ma resta inerte: nessuna riga la usa
e il codice applicativo non la referenzia mai.

Revision ID: 0003_assignment_cause_visita_idoneita_lowercase
Revises: 0002_assignment_cause_visita_idoneita
Create Date: 2026-08-26
"""

from alembic import op


revision = "0003_assignment_cause_visita_idoneita_lowercase"
down_revision = "0002_assignment_cause_visita_idoneita"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    op.execute("ALTER TYPE assignment_cause ADD VALUE IF NOT EXISTS 'visita_idoneita'")


def downgrade() -> None:
    # Postgres non sa rimuovere un valore da un enum: servirebbe ricreare il tipo
    # e riscrivere la colonna su dati reali. Il valore resta inerte se inutilizzato.
    pass

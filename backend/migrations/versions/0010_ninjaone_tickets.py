"""Tabella ninjaone_tickets: traccia i ticket aperti da T-Hub verso NinjaOne
via POST /v2/ticketing/ticket (services/ninjaone.py::create_ticket). Salva solo
lo stato all'apertura, nessun aggiornamento successivo (né polling né webhook).

Migrazione additiva: una tabella nuova.

Revision ID: 0010_ninjaone_tickets
Revises: 0003_assignment_cause_visita_idoneita_lowercase
Create Date: 2026-08-31

Nota: aggancia all'ultima revisione committata in git (0003), non alla 0009
del modulo Manutenzioni — quella catena (0004-0009) esiste solo nel working
tree, mai committata. Se in futuro viene committata separatamente, questa
revisione andrà riordinata per evitare due head paralleli.
"""

import sqlalchemy as sa
from alembic import op

revision = "0010_ninjaone_tickets"
down_revision = "0003_assignment_cause_visita_idoneita_lowercase"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("ninjaone_tickets"):
        op.create_table(
            "ninjaone_tickets",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("ninja_ticket_id", sa.String(64), nullable=False),
            sa.Column("subject", sa.String(255), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("priority", sa.String(32), nullable=False),
            sa.Column("status", sa.String(32), nullable=False),
            sa.Column("requested_by_id", sa.String(36), sa.ForeignKey("employees.id"), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )
        op.create_index("ix_ninjaone_tickets_ninja_ticket_id", "ninjaone_tickets", ["ninja_ticket_id"])
        op.create_index("ix_ninjaone_tickets_requested_by_id", "ninjaone_tickets", ["requested_by_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if inspector.has_table("ninjaone_tickets"):
        op.drop_table("ninjaone_tickets")

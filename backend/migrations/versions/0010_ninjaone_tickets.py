"""Tabella ninjaone_tickets: traccia i ticket aperti da T-Hub verso NinjaOne
via POST /v2/ticketing/ticket (services/ninjaone.py::create_ticket). Salva solo
lo stato all'apertura, nessun aggiornamento successivo (né polling né webhook).

Ricreata il 2026-09-03: il feature NinjaOne Tickets è stato revertato dal
codice (commit 4e6bb9b) dopo che questa migrazione era già stata applicata in
produzione (31/08/2026). Il file va ripristinato solo per continuità della
catena Alembic — vedi AGENTS.md §7 per la tabella orfana che ne risulta: nessun
modello/endpoint la usa più, non reintrodurre il feature senza deciderlo
esplicitamente con l'utente.

Migrazione additiva: una tabella nuova.

Revision ID: 0010_ninjaone_tickets
Revises: 0009_maintenance_notification_rules
Create Date: 2026-08-31
"""

import sqlalchemy as sa
from alembic import op

revision = "0010_ninjaone_tickets"
down_revision = "0009_maintenance_notification_rules"
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

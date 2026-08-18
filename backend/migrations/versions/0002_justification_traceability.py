"""Tracciabilità sulle richieste di assenza: chi le ha create e chi le ha decise.

Aggiunge a `justifications` le colonne created_by_name, decided_by_name,
decided_at (nullable: le richieste storiche restano senza, il frontend usa
requested_by come fallback). La migrazione è difensiva (controlla l'esistenza
delle colonne) perché lo stesso schema viene garantito anche da
ensure_schema_updates all'avvio dell'applicazione.

Revision ID: 0002_justification_traceability
Revises: 0001_baseline
Create Date: 2026-07-03

"""
import sqlalchemy as sa
from alembic import op

revision = "0002_justification_traceability"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("justifications")}


def upgrade() -> None:
    columns = _existing_columns()
    if "created_by_name" not in columns:
        op.add_column("justifications", sa.Column("created_by_name", sa.String(255), nullable=True))
    if "decided_by_name" not in columns:
        op.add_column("justifications", sa.Column("decided_by_name", sa.String(255), nullable=True))
    if "decided_at" not in columns:
        op.add_column("justifications", sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    columns = _existing_columns()
    for name in ("decided_at", "decided_by_name", "created_by_name"):
        if name in columns:
            op.drop_column("justifications", name)

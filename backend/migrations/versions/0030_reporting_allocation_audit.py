"""Autore e data di creazione/modifica sulle caselle rendicontate.

Stesso metodo del Planner (``assignments.last_modified_by_name``): il nome
dell'autore è denormalizzato sulla riga e i timestamp restano nullable, perché
le caselle salvate prima di questa revisione non hanno una data reale.

Revision ID: 0030_reporting_allocation_audit
Revises: 0029_planner_audit
Create Date: 2026-08-21
"""

import sqlalchemy as sa
from alembic import op


revision = "0030_reporting_allocation_audit"
down_revision = "0029_planner_audit"
branch_labels = None
depends_on = None


NEW_COLUMNS = (
    ("created_by_name", sa.String(length=120)),
    ("created_at", sa.DateTime(timezone=True)),
    ("last_modified_by_name", sa.String(length=120)),
    ("last_modified_at", sa.DateTime(timezone=True)),
)


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    for name, column_type in NEW_COLUMNS:
        if name not in columns:
            op.add_column("operational_report_allocations", sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    for name, _ in reversed(NEW_COLUMNS):
        if name in columns:
            op.drop_column("operational_report_allocations", name)

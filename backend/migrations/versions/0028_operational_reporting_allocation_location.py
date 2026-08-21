"""Area e Immobile effettivi sulla singola attività rendicontata.

Revision ID: 0028_reporting_allocation_location
Revises: 0027_maintenance_questionnaire
Create Date: 2026-08-18
"""

import sqlalchemy as sa
from alembic import op


revision = "0028_reporting_allocation_location"
down_revision = "0027_maintenance_questionnaire"
branch_labels = None
depends_on = None


TABLE = "operational_report_allocations"
# NULL significa "eredita la posizione del blocco": le rendicontazioni già
# salvate restano valide senza backfill.
COLUMNS = (
    ("actual_area_id", sa.String(length=36)),
    ("actual_area_name_snapshot", sa.String(length=120)),
    ("actual_building", sa.String(length=50)),
)
INDEX = "ix_operational_report_allocations_actual_area_id"


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    columns = {item["name"] for item in inspector.get_columns(TABLE)}
    for name, column_type in COLUMNS:
        if name not in columns:
            op.add_column(TABLE, sa.Column(name, column_type, nullable=True))
    indexes = {item["name"] for item in inspector.get_indexes(TABLE)}
    if INDEX not in indexes:
        op.create_index(INDEX, TABLE, ["actual_area_id"], unique=False, if_not_exists=True)


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table(TABLE):
        return
    indexes = {item["name"] for item in inspector.get_indexes(TABLE)}
    if INDEX in indexes:
        op.drop_index(INDEX, table_name=TABLE)
    columns = {item["name"] for item in inspector.get_columns(TABLE)}
    for name, _ in COLUMNS:
        if name in columns:
            op.drop_column(TABLE, name)

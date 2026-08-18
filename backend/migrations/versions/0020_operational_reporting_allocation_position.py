"""Posizione temporale dei box di rendicontazione.

Revision ID: 0020_operational_reporting_position
Revises: 0019_operational_reporting_sequence
Create Date: 2026-08-13
"""

import sqlalchemy as sa
from alembic import op


revision = "0020_operational_reporting_position"
down_revision = "0019_operational_reporting_sequence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    if "start_offset_minutes" in columns:
        return
    op.add_column(
        "operational_report_allocations",
        sa.Column("start_offset_minutes", sa.Integer(), nullable=False, server_default="0"),
    )
    rows = bind.execute(sa.text(
        "SELECT id, block_id, minutes FROM operational_report_allocations "
        "ORDER BY block_id, sequence, id"
    )).mappings()
    offsets: dict[str, int] = {}
    for row in rows:
        offset = offsets.get(row["block_id"], 0)
        bind.execute(
            sa.text("UPDATE operational_report_allocations SET start_offset_minutes = :offset WHERE id = :id"),
            {"offset": offset, "id": row["id"]},
        )
        offsets[row["block_id"]] = offset + int(row["minutes"])


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("operational_report_allocations"):
        columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
        if "start_offset_minutes" in columns:
            op.drop_column("operational_report_allocations", "start_offset_minutes")

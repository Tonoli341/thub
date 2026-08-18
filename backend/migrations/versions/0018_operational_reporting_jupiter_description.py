"""Secondo livello Descrizione Jupiter nelle allocazioni operative.

Revision ID: 0018_operational_reporting_jupiter
Revises: 0017_operational_reporting
Create Date: 2026-08-13
"""

import sqlalchemy as sa
from alembic import op


revision = "0018_operational_reporting_jupiter"
down_revision = "0017_operational_reporting"
branch_labels = None
depends_on = None


OLD_CONSTRAINT = "uq_operational_report_block_customer"
NEW_CONSTRAINT = "uq_operational_report_block_customer_jupiter"


def _unique_constraints(inspector) -> set[str]:
    return {
        item["name"]
        for item in inspector.get_unique_constraints("operational_report_allocations")
        if item.get("name")
    }


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("operational_report_allocations"):
        return
    columns = {item["name"] for item in inspector.get_columns("operational_report_allocations")}
    if "jupiter_description_snapshot" not in columns:
        op.add_column(
            "operational_report_allocations",
            sa.Column("jupiter_description_snapshot", sa.Text(), nullable=True),
        )

    inspector = sa.inspect(bind)
    constraints = _unique_constraints(inspector)
    if OLD_CONSTRAINT in constraints:
        op.drop_constraint(OLD_CONSTRAINT, "operational_report_allocations", type_="unique")
    if NEW_CONSTRAINT not in constraints:
        op.create_unique_constraint(
            NEW_CONSTRAINT,
            "operational_report_allocations",
            ["block_id", "customer_code", "jupiter_description_snapshot"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if not inspector.has_table("operational_report_allocations"):
        return
    constraints = _unique_constraints(inspector)
    if NEW_CONSTRAINT in constraints:
        op.drop_constraint(NEW_CONSTRAINT, "operational_report_allocations", type_="unique")
    # Il downgrade non può comprimere automaticamente più descrizioni dello
    # stesso cliente: fallirà correttamente se esistono duplicati incompatibili.
    if OLD_CONSTRAINT not in constraints:
        op.create_unique_constraint(
            OLD_CONSTRAINT,
            "operational_report_allocations",
            ["block_id", "customer_code"],
        )
    columns = {item["name"] for item in sa.inspect(bind).get_columns("operational_report_allocations")}
    if "jupiter_description_snapshot" in columns:
        op.drop_column("operational_report_allocations", "jupiter_description_snapshot")

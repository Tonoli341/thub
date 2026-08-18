"""Consente attività ripetute ai lati di una pausa.

Revision ID: 0021_operational_reporting_repeated
Revises: 0020_operational_reporting_position
Create Date: 2026-08-17
"""

import sqlalchemy as sa
from alembic import op


revision = "0021_operational_reporting_repeated"
down_revision = "0020_operational_reporting_position"
branch_labels = None
depends_on = None


CONSTRAINT = "uq_operational_report_block_customer_jupiter"


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    constraints = {
        item["name"]
        for item in sa.inspect(bind).get_unique_constraints("operational_report_allocations")
    }
    if CONSTRAINT in constraints:
        op.drop_constraint(CONSTRAINT, "operational_report_allocations", type_="unique")


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.create_unique_constraint(
            CONSTRAINT,
            "operational_report_allocations",
            ["block_id", "customer_code", "jupiter_description_snapshot"],
        )

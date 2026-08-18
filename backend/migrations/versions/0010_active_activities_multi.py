"""Attività realtime multi-attività in parallelo.

Sostituisce il vincolo di unicità su active_activities: da un solo timer per
dipendente (uq_active_activity_employee) a un timer per coppia
(employee_id, mapping_id), così l'operatore può avere più attività attive in
parallelo purché su incroci diversi.

Revision ID: 0010_active_activities_multi
Revises: 0009_employee_deliveries_access
Create Date: 2026-07-10

"""
import sqlalchemy as sa
from alembic import op

revision = "0010_active_activities_multi"
down_revision = "0009_employee_deliveries_access"
branch_labels = None
depends_on = None

OLD_UQ = "uq_active_activity_employee"
NEW_UQ = "uq_active_activity_employee_mapping"


def _constraint_names(inspector, table: str) -> set[str]:
    names = {uc["name"] for uc in inspector.get_unique_constraints(table)}
    # Alcuni backend espongono i vincoli unici anche come indici
    names |= {idx["name"] for idx in inspector.get_indexes(table)}
    return names


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = _constraint_names(inspector, "active_activities")

    with op.batch_alter_table("active_activities") as batch:
        if OLD_UQ in existing:
            batch.drop_constraint(OLD_UQ, type_="unique")
        if NEW_UQ not in existing:
            batch.create_unique_constraint(NEW_UQ, ["employee_id", "mapping_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing = _constraint_names(inspector, "active_activities")

    with op.batch_alter_table("active_activities") as batch:
        if NEW_UQ in existing:
            batch.drop_constraint(NEW_UQ, type_="unique")
        if OLD_UQ not in existing:
            batch.create_unique_constraint(OLD_UQ, ["employee_id"])

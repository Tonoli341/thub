"""Timer paralleli sullo stesso incrocio con campi obbligatori diversi.

Aggiunge active_activities.conflict_key (hash dei valori normalizzati dei
campi obbligatori del mapping, '' se non ce ne sono) e sostituisce il vincolo
di unicità (employee_id, mapping_id) con (employee_id, mapping_id,
conflict_key): due timer sullo stesso incrocio convivono se almeno un campo
obbligatorio (es. "numero lista") ha un valore diverso.

Il backfill a '' delle righe esistenti è sicuro: sotto il vincolo precedente
esiste al più un timer aperto per incrocio (ensure_schema_updates ricalcola
comunque la chiave dei timer aperti al primo avvio).

Revision ID: 0013_active_activities_conflict_key
Revises: 0012_device_delivery_policy
Create Date: 2026-07-14

"""
import sqlalchemy as sa
from alembic import op

revision = "0013_active_activities_conflict_key"
down_revision = "0012_device_delivery_policy"
branch_labels = None
depends_on = None

OLD_UQ = "uq_active_activity_employee_mapping"
NEW_UQ = "uq_active_activity_employee_mapping_conflict"


def _constraint_names(inspector, table: str) -> set[str]:
    names = {uc["name"] for uc in inspector.get_unique_constraints(table)}
    # Alcuni backend espongono i vincoli unici anche come indici
    names |= {idx["name"] for idx in inspector.get_indexes(table)}
    return names


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("active_activities")}
    existing = _constraint_names(inspector, "active_activities")

    with op.batch_alter_table("active_activities") as batch:
        if "conflict_key" not in columns:
            batch.add_column(sa.Column("conflict_key", sa.String(64), nullable=False, server_default=""))
        if OLD_UQ in existing:
            batch.drop_constraint(OLD_UQ, type_="unique")
        if NEW_UQ not in existing:
            batch.create_unique_constraint(NEW_UQ, ["employee_id", "mapping_id", "conflict_key"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("active_activities")}
    existing = _constraint_names(inspector, "active_activities")

    # Il downgrade fallisce se esistono più timer aperti sullo stesso incrocio:
    # vanno chiusi prima di tornare al vincolo (employee_id, mapping_id).
    with op.batch_alter_table("active_activities") as batch:
        if NEW_UQ in existing:
            batch.drop_constraint(NEW_UQ, type_="unique")
        if "conflict_key" in columns:
            batch.drop_column("conflict_key")
        if OLD_UQ not in existing:
            batch.create_unique_constraint(OLD_UQ, ["employee_id", "mapping_id"])

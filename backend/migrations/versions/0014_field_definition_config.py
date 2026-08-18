"""Configurazione dei campi value-list MSSQL.

Aggiunge field_definitions.config (JSON, nullable): per il tipo "mssql_list"
contiene {source, key_column, columns}, cioè quale sorgente del registro
server-side usare, quale colonna è la chiave e quali colonne mostrare come
dettaglio. La SQL non è mai qui: vive solo in services/value_list_sources.py
e nelle Settings.

Nullable senza backfill: i tipi esistenti (text/number/date/select) non usano
config e restano a NULL.

Revision ID: 0014_field_definition_config
Revises: 0013_active_activities_conflict_key
Create Date: 2026-07-17

"""
import sqlalchemy as sa
from alembic import op

revision = "0014_field_definition_config"
down_revision = "0013_active_activities_conflict_key"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("field_definitions")}

    if "config" not in columns:
        op.add_column("field_definitions", sa.Column("config", sa.JSON(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("field_definitions")}

    if "config" in columns:
        op.drop_column("field_definitions", "config")

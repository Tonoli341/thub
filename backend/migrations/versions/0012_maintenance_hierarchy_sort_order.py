"""Aggiunge sort_order a famiglie, classi e sottoclassi di asset per
permettere il riordino manuale in UI (drag & drop nella pagina di
amministrazione, riflesso nell'ordine delle voci di menu in sidebar).

Colonna additiva con backfill: l'ordine iniziale ricalca quello alfabetico
già in uso (order_by="...label" nei relationship SQLAlchemy), così il primo
avvio dopo la migrazione non stravolge quello che gli utenti vedono oggi.
Il backfill è scoping per genitore (classi dentro la stessa famiglia,
sottoclassi dentro la stessa classe): il riordino manuale resta anch'esso
scoping per genitore, non tra genitori diversi.

Revision ID: 0011_maintenance_hierarchy_sort_order
Revises: 0010_maintenance_asset_families
Create Date: 2026-08-31
"""

import sqlalchemy as sa
from alembic import op

revision = "0011_maintenance_hierarchy_sort_order"
down_revision = "0010_maintenance_asset_families"
branch_labels = None
depends_on = None

_TABLES_WITH_PARENT_SCOPE = {
    "maintenance_asset_families": None,
    "maintenance_asset_classes": "family_id",
    "maintenance_asset_types": "asset_class_id",
}


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table_name, parent_column in _TABLES_WITH_PARENT_SCOPE.items():
        columns = {col["name"] for col in inspector.get_columns(table_name)}
        if "sort_order" not in columns:
            op.add_column(
                table_name,
                sa.Column("sort_order", sa.Integer(), nullable=False, server_default="0"),
            )
        partition = f"PARTITION BY {parent_column}" if parent_column else ""
        op.execute(
            f"""
            UPDATE {table_name} AS t
            SET sort_order = ranked.rn
            FROM (
                SELECT id, ROW_NUMBER() OVER ({partition} ORDER BY label ASC) - 1 AS rn
                FROM {table_name}
            ) AS ranked
            WHERE t.id = ranked.id
            """
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    for table_name in _TABLES_WITH_PARENT_SCOPE:
        columns = {col["name"] for col in inspector.get_columns(table_name)}
        if "sort_order" in columns:
            op.drop_column(table_name, "sort_order")

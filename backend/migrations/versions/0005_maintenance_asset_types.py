"""Modulo Manutenzioni: introduce la tipologia come livello tra categoria e
asset (Asset -> Categoria -> Tipologia -> asset singolo).

I campi configurabili e gli asset si agganciano ora alla tipologia
(es. "Frontale", "Retrattile"), non più direttamente alla categoria
(es. "Carrelli elevatori"): in pratica gli attributi rilevanti cambiano anche
all'interno della stessa categoria.

Backfill: ogni categoria esistente riceve una tipologia "Generico" che eredita
i campi e gli asset già presenti, così i dati creati durante il pilota non si
perdono. Le tipologie vere si creano poi dall'interfaccia di gestione.

Come 0004, ogni passo è condizionato all'assenza della colonna/tabella
corrispondente: `create_all()` gira a ogni avvio (AGENTS.md §1.2) e questa
revisione potrebbe non essere la prima a incontrare lo schema già a un punto
intermedio.

Revision ID: 0005_maintenance_asset_types
Revises: 0003_maintenance_assets
Create Date: 2026-08-27
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0005_maintenance_asset_types"
down_revision = "0003_maintenance_assets"
branch_labels = None
depends_on = None


def _fk_name(inspector, table_name, column_name):
    for fk in inspector.get_foreign_keys(table_name):
        if column_name in fk["constrained_columns"]:
            return fk["name"]
    raise RuntimeError(f"Foreign key su {table_name}.{column_name} non trovata")


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("maintenance_asset_types"):
        op.create_table(
            "maintenance_asset_types",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("asset_class_id", sa.String(36), sa.ForeignKey("maintenance_asset_classes.id"), nullable=False),
            sa.Column("code", sa.String(60), nullable=False),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.UniqueConstraint("asset_class_id", "code", name="uq_maintenance_asset_type_code"),
        )

    asset_classes = sa.table(
        "maintenance_asset_classes",
        sa.column("id", sa.String),
        sa.column("code", sa.String),
    )
    asset_types = sa.table(
        "maintenance_asset_types",
        sa.column("id", sa.String),
        sa.column("asset_class_id", sa.String),
        sa.column("code", sa.String),
        sa.column("label", sa.String),
        sa.column("is_active", sa.Boolean),
    )

    existing_classes = bind.execute(sa.select(asset_classes.c.id)).scalars().all()
    existing_default_by_class = {
        row.asset_class_id: row.id
        for row in bind.execute(
            sa.select(asset_types.c.id, asset_types.c.asset_class_id).where(asset_types.c.code == "generico")
        )
    }

    default_type_by_class = {}
    for class_id in existing_classes:
        if class_id in existing_default_by_class:
            default_type_by_class[class_id] = existing_default_by_class[class_id]
            continue
        new_type_id = str(uuid4())
        bind.execute(
            asset_types.insert().values(
                id=new_type_id, asset_class_id=class_id, code="generico", label="Generico", is_active=True
            )
        )
        default_type_by_class[class_id] = new_type_id

    # maintenance_asset_fields: da asset_class_id a asset_type_id
    field_columns = {col["name"] for col in inspector.get_columns("maintenance_asset_fields")}
    if "asset_type_id" not in field_columns:
        op.add_column("maintenance_asset_fields", sa.Column("asset_type_id", sa.String(36), nullable=True))
        for class_id, type_id in default_type_by_class.items():
            bind.execute(
                sa.text(
                    "UPDATE maintenance_asset_fields SET asset_type_id = :type_id WHERE asset_class_id = :class_id"
                ),
                {"type_id": type_id, "class_id": class_id},
            )
        op.alter_column("maintenance_asset_fields", "asset_type_id", nullable=False)
        op.create_foreign_key(
            "fk_maintenance_asset_fields_asset_type_id",
            "maintenance_asset_fields",
            "maintenance_asset_types",
            ["asset_type_id"],
            ["id"],
        )
        op.drop_constraint("uq_maintenance_asset_field_key", "maintenance_asset_fields", type_="unique")
        op.create_unique_constraint(
            "uq_maintenance_asset_field_key", "maintenance_asset_fields", ["asset_type_id", "field_key"]
        )
        op.drop_constraint(
            _fk_name(inspector, "maintenance_asset_fields", "asset_class_id"),
            "maintenance_asset_fields",
            type_="foreignkey",
        )
        op.drop_column("maintenance_asset_fields", "asset_class_id")

    # maintenance_assets: da asset_class_id a asset_type_id
    inspector = sa.inspect(bind)
    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if "asset_type_id" not in asset_columns:
        op.add_column("maintenance_assets", sa.Column("asset_type_id", sa.String(36), nullable=True))
        for class_id, type_id in default_type_by_class.items():
            bind.execute(
                sa.text("UPDATE maintenance_assets SET asset_type_id = :type_id WHERE asset_class_id = :class_id"),
                {"type_id": type_id, "class_id": class_id},
            )
        op.alter_column("maintenance_assets", "asset_type_id", nullable=False)
        op.create_foreign_key(
            "fk_maintenance_assets_asset_type_id",
            "maintenance_assets",
            "maintenance_asset_types",
            ["asset_type_id"],
            ["id"],
        )
        op.drop_index("ix_maintenance_assets_asset_class_id", "maintenance_assets")
        op.create_index("ix_maintenance_assets_asset_type_id", "maintenance_assets", ["asset_type_id"])
        op.drop_constraint(
            _fk_name(inspector, "maintenance_assets", "asset_class_id"),
            "maintenance_assets",
            type_="foreignkey",
        )
        op.drop_column("maintenance_assets", "asset_class_id")


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if "asset_class_id" not in asset_columns:
        op.add_column("maintenance_assets", sa.Column("asset_class_id", sa.String(36), nullable=True))
        op.execute(
            "UPDATE maintenance_assets a SET asset_class_id = t.asset_class_id "
            "FROM maintenance_asset_types t WHERE t.id = a.asset_type_id"
        )
        op.alter_column("maintenance_assets", "asset_class_id", nullable=False)
        op.create_foreign_key(
            "maintenance_assets_asset_class_id_fkey",
            "maintenance_assets",
            "maintenance_asset_classes",
            ["asset_class_id"],
            ["id"],
        )
        op.create_index("ix_maintenance_assets_asset_class_id", "maintenance_assets", ["asset_class_id"])
        op.drop_index("ix_maintenance_assets_asset_type_id", "maintenance_assets")
        op.drop_constraint("fk_maintenance_assets_asset_type_id", "maintenance_assets", type_="foreignkey")
        op.drop_column("maintenance_assets", "asset_type_id")

    field_columns = {col["name"] for col in inspector.get_columns("maintenance_asset_fields")}
    if "asset_class_id" not in field_columns:
        op.add_column("maintenance_asset_fields", sa.Column("asset_class_id", sa.String(36), nullable=True))
        op.execute(
            "UPDATE maintenance_asset_fields f SET asset_class_id = t.asset_class_id "
            "FROM maintenance_asset_types t WHERE t.id = f.asset_type_id"
        )
        op.alter_column("maintenance_asset_fields", "asset_class_id", nullable=False)
        op.create_foreign_key(
            "maintenance_asset_fields_asset_class_id_fkey",
            "maintenance_asset_fields",
            "maintenance_asset_classes",
            ["asset_class_id"],
            ["id"],
        )
        op.drop_constraint("uq_maintenance_asset_field_key", "maintenance_asset_fields", type_="unique")
        op.create_unique_constraint(
            "uq_maintenance_asset_field_key", "maintenance_asset_fields", ["asset_class_id", "field_key"]
        )
        op.drop_constraint("fk_maintenance_asset_fields_asset_type_id", "maintenance_asset_fields", type_="foreignkey")
        op.drop_column("maintenance_asset_fields", "asset_type_id")

    op.drop_table("maintenance_asset_types")

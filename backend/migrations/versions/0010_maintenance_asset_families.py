"""Modulo Manutenzioni: introduce la famiglia come livello sopra la classe
(Asset -> Famiglia -> Classe -> Sottoclasse -> asset singolo).

Es.: Famiglia "Sollevamento" -> Classe "Carrello elevatore" -> Sottoclasse
"Frontale"/"Retrattile"/"Shuttle UPC". Stessa logica della 0005 (che aveva
introdotto la tipologia/sottoclasse sopra l'asset): un livello di
raggruppamento in più, niente di scritto sugli asset esistenti.

Backfill: le classi esistenti (create prima di questa revisione) vengono
agganciate a una famiglia "Generico", così i dati del pilota non si perdono —
le famiglie vere si creano poi dall'interfaccia di gestione.

Idempotente come 0003-0009: `create_all()` gira a ogni avvio (AGENTS.md §1.2).

Nota: agganciata dopo 0009_maintenance_notification_rules (non mia, comparsa
nel frattempo) invece che dopo 0008 direttamente, perché quella revisione ha
preso lo stesso down_revision creando due head parallele — stesso caso già
capitato con 0003_assignment_cause_visita_idoneita_lowercase.

Riagganciata il 2026-09-03 a valle di 0010_ninjaone_tickets (anziché
direttamente a 0009): quella migrazione era stata applicata in produzione
prima di essere revertata dal codice, e senza questo aggancio la catena
Alembic in prod resta spezzata. Nessuna DDL di questo file cambia.

Revision ID: 0010_maintenance_asset_families
Revises: 0010_ninjaone_tickets
Create Date: 2026-08-29
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op

revision = "0010_maintenance_asset_families"
down_revision = "0010_ninjaone_tickets"
branch_labels = None
depends_on = None


def _fk_name(inspector, table_name, column_name):
    for fk in inspector.get_foreign_keys(table_name):
        if column_name in fk["constrained_columns"]:
            return fk["name"]
    return None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    if not inspector.has_table("maintenance_asset_families"):
        op.create_table(
            "maintenance_asset_families",
            sa.Column("id", sa.String(36), primary_key=True),
            sa.Column("code", sa.String(60), nullable=False, unique=True),
            sa.Column("label", sa.String(120), nullable=False),
            sa.Column("icon", sa.String(40), nullable=False, server_default="tools"),
            sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
            sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
            sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        )

    inspector = sa.inspect(bind)
    class_columns = {col["name"] for col in inspector.get_columns("maintenance_asset_classes")}
    if "family_id" not in class_columns:
        families = sa.table(
            "maintenance_asset_families",
            sa.column("id", sa.String),
            sa.column("code", sa.String),
            sa.column("label", sa.String),
            sa.column("icon", sa.String),
            sa.column("is_active", sa.Boolean),
        )
        existing_default = bind.execute(
            sa.select(families.c.id).where(families.c.code == "generico")
        ).scalar()
        if existing_default is None:
            default_family_id = str(uuid4())
            bind.execute(
                families.insert().values(
                    id=default_family_id, code="generico", label="Generico", icon="tools", is_active=True
                )
            )
        else:
            default_family_id = existing_default

        op.add_column("maintenance_asset_classes", sa.Column("family_id", sa.String(36), nullable=True))
        bind.execute(
            sa.text("UPDATE maintenance_asset_classes SET family_id = :family_id WHERE family_id IS NULL"),
            {"family_id": default_family_id},
        )
        op.alter_column("maintenance_asset_classes", "family_id", nullable=False)
        op.create_foreign_key(
            "fk_maintenance_asset_classes_family_id",
            "maintenance_asset_classes",
            "maintenance_asset_families",
            ["family_id"],
            ["id"],
        )
        op.create_index("ix_maintenance_asset_classes_family_id", "maintenance_asset_classes", ["family_id"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    class_columns = {col["name"] for col in inspector.get_columns("maintenance_asset_classes")}
    if "family_id" in class_columns:
        op.drop_index("ix_maintenance_asset_classes_family_id", "maintenance_asset_classes")
        fk_name = _fk_name(inspector, "maintenance_asset_classes", "family_id") or "fk_maintenance_asset_classes_family_id"
        op.drop_constraint(fk_name, "maintenance_asset_classes", type_="foreignkey")
        op.drop_column("maintenance_asset_classes", "family_id")

    if inspector.has_table("maintenance_asset_families"):
        op.drop_table("maintenance_asset_families")

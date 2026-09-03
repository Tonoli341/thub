"""Rende configurabili anche gli attributi anagrafici "generici" del carrello
(sito, produttore, modello, numero di serie): fino a qui erano colonne fisse
di MaintenanceAsset con etichetta cablata nel frontend, non modificabili né
rinominabili da Operations senza intervento di codice.

MaintenanceAssetField acquisisce un secondo livello di aggancio: oltre a
asset_type_id (sottoclasse, es. "Frontale" — attributi che variano anche
dentro la stessa classe, invariato) ora anche asset_class_id (classe, es.
"Carrello elevatore" — attributi generici comuni a tutte le sottoclassi).
Esattamente uno dei due è valorizzato per riga (vincolo CHECK). I valori
restano nello stesso posto di sempre: MaintenanceAsset.custom_fields
(JSONB), niente nuova tabella EAV — è la stessa scelta di design già fatta
per i campi di sottoclasse (vedi maintenance_asset_models.py).

Migrazione additiva più backfill: per ogni classe di asset già esistente
crea i 4 campi generici (site, brand, model, serial_number) a livello di
classe, e sposta gli eventuali valori già presenti sulle omonime colonne
fisse dentro custom_fields, prima di droppare le colonne. Con zero asset
reali nel database al momento della scrittura (confermato con l'utente) il
backfill è per lo più una no-op difensiva, non un'operazione a rischio.

Il campo "Codice interno" (internal_code) resta una colonna fissa: ha
generazione automatica e vincolo di unicità applicativo che lo rendono
diverso dagli altri quattro — non è nello scope di questa richiesta.

Revision ID: 0013_maintenance_class_generic_fields
Revises: 0011_maintenance_hierarchy_sort_order
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op

revision = "0013_maintenance_class_generic_fields"
down_revision = "0011_maintenance_hierarchy_sort_order"
branch_labels = None
depends_on = None

_GENERIC_FIELDS = [
    ("site", "Sito"),
    ("brand", "Produttore"),
    ("model", "Modello"),
    ("serial_number", "Numero di serie"),
]


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {col["name"] for col in inspector.get_columns("maintenance_asset_fields")}

    if "asset_class_id" not in columns:
        op.add_column(
            "maintenance_asset_fields",
            sa.Column("asset_class_id", sa.String(length=36), sa.ForeignKey("maintenance_asset_classes.id"), nullable=True),
        )
    op.alter_column("maintenance_asset_fields", "asset_type_id", existing_type=sa.String(length=36), nullable=True)

    existing_constraints = {c["name"] for c in inspector.get_unique_constraints("maintenance_asset_fields")}
    if "uq_maintenance_asset_field_class_key" not in existing_constraints:
        op.create_unique_constraint(
            "uq_maintenance_asset_field_class_key", "maintenance_asset_fields", ["asset_class_id", "field_key"]
        )
    op.execute(
        """
        ALTER TABLE maintenance_asset_fields
        DROP CONSTRAINT IF EXISTS ck_maintenance_asset_field_single_scope
        """
    )
    op.create_check_constraint(
        "ck_maintenance_asset_field_single_scope",
        "maintenance_asset_fields",
        "(asset_type_id IS NOT NULL AND asset_class_id IS NULL) "
        "OR (asset_type_id IS NULL AND asset_class_id IS NOT NULL)",
    )

    # Backfill: crea i 4 campi generici per ogni classe già esistente, e
    # sposta i valori già presenti sulle colonne fisse dentro custom_fields.
    for field_key, label in _GENERIC_FIELDS:
        op.execute(
            sa.text(
                """
                INSERT INTO maintenance_asset_fields
                    (id, asset_class_id, field_key, label, field_type, is_required, is_searchable, options, sort_order, created_at, updated_at)
                SELECT gen_random_uuid()::text, mac.id, :field_key, :label, 'text', false, true, '[]'::jsonb, 0, now(), now()
                FROM maintenance_asset_classes AS mac
                WHERE NOT EXISTS (
                    SELECT 1 FROM maintenance_asset_fields AS f
                    WHERE f.asset_class_id = mac.id AND f.field_key = :field_key
                )
                """
            ).bindparams(field_key=field_key, label=label)
        )

    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    if {"brand", "model", "serial_number", "site"} & asset_columns:
        op.execute(
            """
            UPDATE maintenance_assets
            SET custom_fields = jsonb_strip_nulls(
                custom_fields
                || jsonb_build_object('brand', to_jsonb(brand))
                || jsonb_build_object('model', to_jsonb(model))
                || jsonb_build_object('serial_number', to_jsonb(serial_number))
                || jsonb_build_object('site', to_jsonb(site))
            )
            """
        )
        for column in ("brand", "model", "serial_number", "site"):
            if column in asset_columns:
                op.drop_column("maintenance_assets", column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}
    for column in ("brand", "model", "serial_number", "site"):
        if column not in asset_columns:
            op.add_column("maintenance_assets", sa.Column(column, sa.String(length=120), nullable=True))
    op.execute(
        """
        UPDATE maintenance_assets
        SET brand = custom_fields->>'brand',
            model = custom_fields->>'model',
            serial_number = custom_fields->>'serial_number',
            site = custom_fields->>'site'
        """
    )

    op.execute(
        "DELETE FROM maintenance_asset_fields WHERE asset_class_id IS NOT NULL AND field_key IN ('site', 'brand', 'model', 'serial_number')"
    )

    op.drop_constraint("ck_maintenance_asset_field_single_scope", "maintenance_asset_fields", type_="check")
    op.drop_constraint("uq_maintenance_asset_field_class_key", "maintenance_asset_fields", type_="unique")
    op.alter_column("maintenance_asset_fields", "asset_type_id", existing_type=sa.String(length=36), nullable=False)
    op.drop_column("maintenance_asset_fields", "asset_class_id")

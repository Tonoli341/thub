"""Estende la conversione di 0013 a "reparto" e "responsabile": ultimi due
attributi anagrafici rimasti come colonne fisse di MaintenanceAsset, ora
attributi generici di classe come sito/produttore/modello/numero di serie.

"Responsabile" richiede un tipo di campo nuovo, "employee": un riferimento a
Employee risolto lato UI con una select, non testo libero. Aggiunto al tipo
enum Postgres esistente maintenance_field_type (ALTER TYPE ... ADD VALUE:
operazione additiva, sicura anche a valle di dati esistenti — non tocca i
valori già presenti nell'enum).

Stesso schema di backfill di 0013: crea i due campi di classe, sposta i
valori dalle colonne fisse dentro custom_fields, droppa le colonne. Zero
asset reali nel database al momento della scrittura (confermato con
l'utente): il backfill è una no-op difensiva.

Revision ID: 0014_maintenance_class_employee_fields
Revises: 0013_maintenance_class_generic_fields
Create Date: 2026-09-01
"""

import sqlalchemy as sa
from alembic import op

revision = "0014_maintenance_class_employee_fields"
down_revision = "0013_maintenance_class_generic_fields"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    # ALTER TYPE ... ADD VALUE non può girare dentro la stessa transazione in
    # cui il valore viene poi usato prima di PG12, ma qui lo aggiungiamo e
    # basta: le righe che lo usano arrivano dopo, nello stesso script ma con
    # una connessione separata dal punto di vista del catalogo tipi grazie ad
    # AUTOCOMMIT su questa singola istruzione.
    existing_values = {
        row[0]
        for row in bind.execute(
            sa.text(
                "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'maintenance_field_type'::regtype"
            )
        )
    }
    if "employee" not in existing_values:
        with op.get_context().autocommit_block():
            op.execute("ALTER TYPE maintenance_field_type ADD VALUE 'employee'")

    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}

    for field_key, label, field_type in (
        ("department", "Reparto", "text"),
        ("responsible_employee_id", "Responsabile", "employee"),
    ):
        op.execute(
            sa.text(
                """
                INSERT INTO maintenance_asset_fields
                    (id, asset_class_id, field_key, label, field_type, is_required, is_searchable, options, sort_order, created_at, updated_at)
                SELECT gen_random_uuid()::text, mac.id, :field_key, :label, CAST(:field_type AS maintenance_field_type), false, true, '[]'::jsonb, 0, now(), now()
                FROM maintenance_asset_classes AS mac
                WHERE NOT EXISTS (
                    SELECT 1 FROM maintenance_asset_fields AS f
                    WHERE f.asset_class_id = mac.id AND f.field_key = :field_key
                )
                """
            ).bindparams(field_key=field_key, label=label, field_type=field_type)
        )

    if {"department", "responsible_employee_id"} & asset_columns:
        op.execute(
            """
            UPDATE maintenance_assets
            SET custom_fields = jsonb_strip_nulls(
                custom_fields
                || jsonb_build_object('department', to_jsonb(department))
                || jsonb_build_object('responsible_employee_id', to_jsonb(responsible_employee_id))
            )
            """
        )
        for column in ("department", "responsible_employee_id"):
            if column in asset_columns:
                op.drop_column("maintenance_assets", column)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    asset_columns = {col["name"] for col in inspector.get_columns("maintenance_assets")}

    if "department" not in asset_columns:
        op.add_column("maintenance_assets", sa.Column("department", sa.String(length=120), nullable=True))
    if "responsible_employee_id" not in asset_columns:
        op.add_column(
            "maintenance_assets",
            sa.Column("responsible_employee_id", sa.String(length=36), sa.ForeignKey("employees.id"), nullable=True),
        )
    op.execute(
        """
        UPDATE maintenance_assets
        SET department = custom_fields->>'department',
            responsible_employee_id = custom_fields->>'responsible_employee_id'
        """
    )
    op.execute(
        "DELETE FROM maintenance_asset_fields WHERE asset_class_id IS NOT NULL AND field_key IN ('department', 'responsible_employee_id')"
    )
    # Il valore 'employee' resta nel tipo enum: Postgres non permette di
    # rimuovere un valore da un enum senza ricrearlo, e non c'è più nulla che
    # lo usi dopo questo downgrade — restare inutilizzato non è un problema.

"""Modulo Manutenzioni, fase 1: anagrafica configurabile, documenti su SMB,
scadenzario.

Migrazione additiva: 8 tabelle nuove, nessun ALTER su tabelle esistenti.
Seed: la classe di asset "carrello_elevatore" (pilota) con il nucleo comune di
campi indicato al §5 del documento di analisi requisiti (tipologia,
identificativo, marca, modello, numero di serie sono già colonne
dell'anagrafica: qui restano solo gli attributi extra della classe).

Ogni `create_table`/`create_index` è condizionato a `has_table`/non presenza
dell'indice: `init_db()` chiama `Base.metadata.create_all()` a ogni avvio
(vedi AGENTS.md §1.2), quindi in pratica queste tabelle esistono già — vuote,
senza il seed sotto — nel momento in cui questa revisione viene eseguita
davvero. È lo stesso scenario già capitato con le revisioni 0002-0031: qui lo
si gestisce rendendo la migrazione idempotente invece di scoprirlo a metà
deploy.

Revision ID: 0003_maintenance_assets
Revises: 0010_ninjaone_tickets
Create Date: 2026-08-25

Nota sul nome file: l'id di revisione resta "0003_maintenance_assets" (non
rinominato in "0004...") perché un ambiente l'ha già applicata con questo id
prima che la 0003_assignment_cause_visita_idoneita_lowercase comparisse nel
repo — cambiare l'id qui romperebbe quell'ambiente esattamente come vieta
AGENTS.md §1.2 per le migrazioni già eseguite. Il file si chiama 0004 solo per
tenere l'ordine leggibile su disco.

Riagganciata il 2026-09-03 a valle di 0010_ninjaone_tickets (anziché
direttamente a 0003_assignment_cause_visita_idoneita_lowercase): è il vero
down_revision con cui 0010_ninjaone_tickets fu applicata in produzione (vedi
commit 045fcc7 del 31/08/2026), e nessuna tabella del modulo Manutenzioni
risultava mai creata lì — la catena precedente puntava a un innesto (0009)
mai davvero raggiunto in prod.
"""

from uuid import uuid4

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import JSONB

revision = "0003_maintenance_assets"
down_revision = "0010_ninjaone_tickets"
branch_labels = None
depends_on = None


def _create_table_if_missing(inspector, name, *columns_and_constraints):
    if inspector.has_table(name):
        return
    op.create_table(name, *columns_and_constraints)


def _create_index_if_missing(inspector, index_name, table_name, columns):
    existing = {index["name"] for index in inspector.get_indexes(table_name)} if inspector.has_table(table_name) else set()
    if index_name in existing:
        return
    op.create_index(index_name, table_name, columns)


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)

    _create_table_if_missing(
        inspector,
        "maintenance_asset_classes",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("code", sa.String(60), nullable=False, unique=True),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    _create_table_if_missing(
        inspector,
        "maintenance_asset_fields",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "asset_class_id",
            sa.String(36),
            sa.ForeignKey("maintenance_asset_classes.id"),
            nullable=False,
        ),
        sa.Column("field_key", sa.String(60), nullable=False),
        sa.Column("label", sa.String(120), nullable=False),
        sa.Column(
            "field_type",
            sa.Enum("text", "number", "date", "bool_", "select", name="maintenance_field_type"),
            nullable=False,
        ),
        sa.Column("is_required", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("is_searchable", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("options", JSONB, nullable=False, server_default="[]"),
        sa.Column("sort_order", sa.Integer, nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("asset_class_id", "field_key", name="uq_maintenance_asset_field_key"),
    )

    _create_table_if_missing(
        inspector,
        "maintenance_assets",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column(
            "asset_class_id",
            sa.String(36),
            sa.ForeignKey("maintenance_asset_classes.id"),
            nullable=False,
        ),
        sa.Column("internal_code", sa.String(40), nullable=False, unique=True),
        sa.Column("brand", sa.String(120)),
        sa.Column("model", sa.String(120)),
        sa.Column("serial_number", sa.String(120)),
        sa.Column("site", sa.String(120)),
        sa.Column("department", sa.String(120)),
        sa.Column("responsible_employee_id", sa.String(36), sa.ForeignKey("employees.id")),
        sa.Column(
            "status",
            sa.Enum(
                "attivo", "in_manutenzione", "dismesso", "fuori_servizio",
                name="maintenance_asset_status",
            ),
            nullable=False,
            server_default="attivo",
        ),
        sa.Column("status_reason", sa.String(255)),
        sa.Column("custom_fields", JSONB, nullable=False, server_default="{}"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    _create_index_if_missing(inspector, "ix_maintenance_assets_asset_class_id", "maintenance_assets", ["asset_class_id"])

    _create_table_if_missing(
        inspector,
        "maintenance_asset_history",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("maintenance_assets.id"), nullable=False),
        sa.Column("changed_field", sa.String(40), nullable=False),
        sa.Column("old_value", sa.String(255)),
        sa.Column("new_value", sa.String(255)),
        sa.Column("reason", sa.Text),
        sa.Column("changed_by", sa.String(120)),
        sa.Column("changed_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    _create_index_if_missing(inspector, "ix_maintenance_asset_history_asset_id", "maintenance_asset_history", ["asset_id"])

    _create_table_if_missing(
        inspector,
        "maintenance_asset_counters",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("maintenance_assets.id"), nullable=False),
        sa.Column("reading_date", sa.Date, nullable=False),
        sa.Column("value", sa.Numeric(12, 2), nullable=False),
        sa.Column("unit", sa.String(10), nullable=False),
        sa.Column("recorded_by", sa.String(120)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    _create_index_if_missing(inspector, "ix_maintenance_asset_counters_asset_id", "maintenance_asset_counters", ["asset_id"])

    _create_table_if_missing(
        inspector,
        "maintenance_documents",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("maintenance_assets.id"), nullable=False),
        sa.Column("doc_type", sa.String(60), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column(
            "status",
            sa.Enum("rilasciato", "obsoleto", name="maintenance_document_status"),
            nullable=False,
            server_default="rilasciato",
        ),
        sa.Column("version", sa.Integer, nullable=False, server_default="1"),
        sa.Column("supersedes_id", sa.String(36), sa.ForeignKey("maintenance_documents.id")),
        sa.Column("file_path", sa.String(400), nullable=False),
        sa.Column("original_filename", sa.String(255), nullable=False),
        sa.Column("mime_type", sa.String(120), nullable=False),
        sa.Column("size_bytes", sa.Integer, nullable=False),
        sa.Column("uploaded_by", sa.String(120)),
        sa.Column("deleted_at", sa.DateTime(timezone=True)),
        sa.Column("deleted_by", sa.String(120)),
        sa.Column("deletion_reason", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    _create_index_if_missing(inspector, "ix_maintenance_documents_asset_id", "maintenance_documents", ["asset_id"])

    _create_table_if_missing(
        inspector,
        "maintenance_deadlines",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("asset_id", sa.String(36), sa.ForeignKey("maintenance_assets.id"), nullable=False),
        sa.Column("deadline_type", sa.String(120), nullable=False),
        sa.Column("due_date", sa.Date, nullable=False),
        sa.Column(
            "recurrence_basis",
            sa.Enum("da_effettiva", "da_prevista", name="maintenance_deadline_recurrence_basis"),
        ),
        sa.Column("recurrence_days", sa.Integer),
        sa.Column("notice_thresholds_days", JSONB, nullable=False, server_default="[30, 15, 7]"),
        sa.Column("last_completed_at", sa.Date),
        sa.Column("postponed_reason", sa.Text),
        sa.Column("is_active", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    _create_index_if_missing(inspector, "ix_maintenance_deadlines_asset_id", "maintenance_deadlines", ["asset_id"])

    _create_table_if_missing(
        inspector,
        "maintenance_deadline_acks",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("deadline_id", sa.String(36), sa.ForeignKey("maintenance_deadlines.id"), nullable=False),
        sa.Column("user_id", sa.String(36), sa.ForeignKey("users.id"), nullable=False),
        sa.Column("acked_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("deadline_id", "user_id", name="uq_maintenance_deadline_ack"),
    )
    _create_index_if_missing(inspector, "ix_maintenance_deadline_acks_deadline_id", "maintenance_deadline_acks", ["deadline_id"])

    # Seed: pilota carrelli elevatori, nucleo comune extra oltre alle colonne
    # già presenti in maintenance_assets (§5 del documento requisiti).
    # Guardia per codice classe: create_all() crea le tabelle vuote a ogni
    # avvio, questo insert deve poter girare comunque (prima esecuzione reale
    # del seed) senza sollevare un errore di unique constraint se rieseguito.
    asset_classes = sa.table(
        "maintenance_asset_classes",
        sa.column("id", sa.String),
        sa.column("code", sa.String),
        sa.column("label", sa.String),
        sa.column("is_active", sa.Boolean),
    )
    asset_fields = sa.table(
        "maintenance_asset_fields",
        sa.column("id", sa.String),
        sa.column("asset_class_id", sa.String),
        sa.column("field_key", sa.String),
        sa.column("label", sa.String),
        # Deve essere lo stesso tipo Enum della colonna reale: con sa.String
        # psycopg tenta un bind ::VARCHAR contro una colonna che a database è
        # il tipo nativo maintenance_field_type, e Postgres rifiuta il cast.
        sa.column("field_type", sa.Enum("text", "number", "date", "bool_", "select", name="maintenance_field_type")),
        sa.column("is_required", sa.Boolean),
        sa.column("is_searchable", sa.Boolean),
        sa.column("options", JSONB),
        sa.column("sort_order", sa.Integer),
    )

    existing_class_id = bind.execute(
        sa.select(asset_classes.c.id).where(asset_classes.c.code == "carrello_elevatore")
    ).scalar()

    if existing_class_id is None:
        carrello_class_id = str(uuid4())
        op.bulk_insert(
            asset_classes,
            [
                {
                    "id": carrello_class_id,
                    "code": "carrello_elevatore",
                    "label": "Carrello elevatore",
                    "is_active": True,
                }
            ],
        )
    else:
        carrello_class_id = existing_class_id

    existing_field_keys = set(
        bind.execute(
            sa.select(asset_fields.c.field_key).where(asset_fields.c.asset_class_id == carrello_class_id)
        ).scalars()
    )

    candidate_fields = [
        {
            "id": str(uuid4()),
            "asset_class_id": carrello_class_id,
            "field_key": "alimentazione",
            "label": "Alimentazione",
            "field_type": "select",
            "is_required": False,
            "is_searchable": True,
            "options": ["elettrico", "gpl", "diesel"],
            "sort_order": 10,
        },
        {
            "id": str(uuid4()),
            "asset_class_id": carrello_class_id,
            "field_key": "portata_kg",
            "label": "Portata nominale (kg)",
            "field_type": "number",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 20,
        },
        {
            "id": str(uuid4()),
            "asset_class_id": carrello_class_id,
            "field_key": "tipo_montante",
            "label": "Tipologia montante",
            "field_type": "text",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 30,
        },
        {
            "id": str(uuid4()),
            "asset_class_id": carrello_class_id,
            "field_key": "altezza_montante_mm",
            "label": "Altezza montante (mm)",
            "field_type": "number",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 40,
        },
        {
            "id": str(uuid4()),
            "asset_class_id": carrello_class_id,
            "field_key": "lunghezza_forche_mm",
            "label": "Lunghezza forche (mm)",
            "field_type": "number",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 50,
        },
        {
            "id": str(uuid4()),
            "asset_class_id": carrello_class_id,
            "field_key": "conducente_abituale",
            "label": "Conducente abituale",
            "field_type": "text",
            "is_required": False,
            "is_searchable": False,
            "options": [],
            "sort_order": 60,
        },
    ]
    new_fields = [field for field in candidate_fields if field["field_key"] not in existing_field_keys]
    if new_fields:
        op.bulk_insert(asset_fields, new_fields)


def downgrade() -> None:
    op.drop_table("maintenance_deadline_acks")
    op.drop_table("maintenance_deadlines")
    op.drop_table("maintenance_documents")
    op.drop_table("maintenance_asset_counters")
    op.drop_table("maintenance_asset_history")
    op.drop_table("maintenance_assets")
    op.drop_table("maintenance_asset_fields")
    op.drop_table("maintenance_asset_classes")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("DROP TYPE IF EXISTS maintenance_deadline_recurrence_basis")
        op.execute("DROP TYPE IF EXISTS maintenance_document_status")
        op.execute("DROP TYPE IF EXISTS maintenance_asset_status")
        op.execute("DROP TYPE IF EXISTS maintenance_field_type")

"""Baseline: schema esistente.

Lo schema di partenza è quello creato/allineato da app.db.init_db()
(create_all + ensure_schema_updates) sul database di produzione con dati reali.
Questa revisione è volutamente vuota: serve solo come punto zero della history.
I database esistenti vengono marcati automaticamente a questa revisione
dall'auto-stamp in init_db; da qui in poi ogni modifica di schema va fatta con:

    alembic revision --autogenerate -m "descrizione"
    alembic upgrade head

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-03

"""

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

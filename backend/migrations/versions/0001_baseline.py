"""Baseline: lo schema già in produzione al 2026-08-21.

Revisione volutamente **vuota**: non crea e non altera nulla. Il punto zero
della history è lo schema che `app.db.init_db()` ha costruito nel tempo
(`create_all` + `ensure_schema_updates` + `ensure_operational_reporting_schema`)
sul database di produzione con dati reali.

Perché è stata riscritta. Le revisioni 0002→0031 esistevano ma non sono mai
state eseguite: `init_db()` non chiama `alembic upgrade` e i database restavano
fermi a questa baseline mentre lo schema avanzava per conto suo. Duplicavano
quindi gli ALTER già presenti in `db.py`. Sono state rimosse e assorbite qui:
il loro contenuto è già nello schema reale, non c'è nulla da riapplicare.

Effetto sui database esistenti: **nessuno**. L'id di revisione è rimasto
`0001_baseline`, quindi le righe `alembic_version` già scritte restano valide e
non serve alcun intervento sul database di produzione.

Da qui in avanti Alembic è il meccanismo ufficiale:

    alembic revision --autogenerate -m "descrizione"
    alembic upgrade head          # passo esplicito del deploy, non all'avvio

`ensure_schema_updates()` resta al suo posto e continua a girare come rete di
sicurezza per i database rimasti indietro, ma è **congelata**: le modifiche di
schema nuove passano solo da qui.

Revision ID: 0001_baseline
Revises:
Create Date: 2026-07-03
Rewritten: 2026-08-21

"""

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

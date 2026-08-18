"""Aggiunge riferimenti FK per chi ha deciso una richiesta di assenza.

decided_by_name resta invariata come stringa denormalizzata: continua a
coprire i casi senza identità risolvibile (utenti portale/LDAP senza
dipendente collegato, approvazioni via link email con employee non trovato).
Le nuove colonne decided_by_employee_id e decided_by_user_id puntano
rispettivamente a employees.id e users.id quando l'identità di chi ha deciso
è risolvibile, e da questa revisione in poi vengono valorizzate dal codice
applicativo ad ogni nuova decisione (vedi
app.services.justification_approval.apply_justification_approval_update).

Per le richieste storiche viene eseguito un backfill best-effort che associa
decided_by_name al nome di un employee o allo username/display_name di uno
user esistente, ma SOLO quando il nome corrisponde a un'unica riga (per
evitare di collegare una richiesta alla persona sbagliata in caso di
omonimie). Dove non c'è corrispondenza univoca la colonna resta NULL e
decided_by_name rimane l'unica fonte disponibile: nessun dato esistente
viene perso o modificato.

Revision ID: 0006_justification_decided_by_fk
Revises: 0005_device_delivery_pending_signature
Create Date: 2026-07-10

"""
import sqlalchemy as sa
from alembic import op

revision = "0006_justification_decided_by_fk"
down_revision = "0005_device_delivery_pending_signature"
branch_labels = None
depends_on = None


def _existing_columns() -> set[str]:
    inspector = sa.inspect(op.get_bind())
    return {column["name"] for column in inspector.get_columns("justifications")}


def upgrade() -> None:
    columns = _existing_columns()
    if "decided_by_employee_id" not in columns:
        op.add_column("justifications", sa.Column("decided_by_employee_id", sa.String(36), nullable=True))
    if "decided_by_user_id" not in columns:
        op.add_column("justifications", sa.Column("decided_by_user_id", sa.String(36), nullable=True))

    bind = op.get_bind()
    bind.execute(sa.text(
        """
        UPDATE justifications
        SET decided_by_employee_id = (
            SELECT e.id FROM employees e WHERE e.full_name = justifications.decided_by_name
        )
        WHERE decided_by_name IS NOT NULL
          AND decided_by_employee_id IS NULL
          AND (SELECT COUNT(*) FROM employees e WHERE e.full_name = justifications.decided_by_name) = 1
        """
    ))
    bind.execute(sa.text(
        """
        UPDATE justifications
        SET decided_by_user_id = (
            SELECT u.id FROM users u
            WHERE u.username = justifications.decided_by_name OR u.display_name = justifications.decided_by_name
        )
        WHERE decided_by_name IS NOT NULL
          AND decided_by_employee_id IS NULL
          AND decided_by_user_id IS NULL
          AND (
              SELECT COUNT(*) FROM users u
              WHERE u.username = justifications.decided_by_name OR u.display_name = justifications.decided_by_name
          ) = 1
        """
    ))


def downgrade() -> None:
    columns = _existing_columns()
    for name in ("decided_by_user_id", "decided_by_employee_id"):
        if name in columns:
            op.drop_column("justifications", name)

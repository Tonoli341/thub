"""Riunisce le revisioni rendicontazione e stato residui.

Revision ID: 0022_merge_reporting_absence
Revises: 0021_operational_reporting_repeated, 0021_absence_balance_status
Create Date: 2026-08-17
"""


revision = "0022_merge_reporting_absence"
down_revision = ("0021_operational_reporting_repeated", "0021_absence_balance_status")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass

from sqlalchemy import Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db import Base
from app.models import TimestampMixin


class MaintenanceQuestionnaire(TimestampMixin, Base):
    """Documento condiviso di raccolta requisiti per il modulo manutenzioni."""

    __tablename__ = "maintenance_questionnaires"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    answers: Mapped[dict] = mapped_column(JSON, default=dict, server_default="{}", nullable=False)
    version: Mapped[int] = mapped_column(Integer, default=1, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)

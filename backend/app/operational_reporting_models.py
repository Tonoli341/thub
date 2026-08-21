"""Persistenza isolata per la rendicontazione operativa derivata dal Planner.

Queste tabelle non sono condivise con Timesheet, DailyRecord o Jupiter: il
Planner viene letto solo per creare lo snapshot iniziale della giornata.
"""

from datetime import date, datetime, time
from uuid import uuid4

from sqlalchemy import Date, DateTime, ForeignKey, Integer, JSON, String, Text, Time, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class OperationalReportDay(Base):
    __tablename__ = "operational_report_days"
    __table_args__ = (
        UniqueConstraint("employee_id", "work_date", name="uq_operational_report_employee_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id"), nullable=False, index=True)
    employee_name_snapshot: Mapped[str] = mapped_column(String(255), nullable=False)
    team_name_snapshot: Mapped[str] = mapped_column(String(120), nullable=False)
    planned_start: Mapped[time] = mapped_column(Time, nullable=False)
    planned_end: Mapped[time] = mapped_column(Time, nullable=False)
    actual_start: Mapped[time] = mapped_column(Time, nullable=False)
    actual_end: Mapped[time] = mapped_column(Time, nullable=False)
    pauses: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    planner_snapshot: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="DRAFT", server_default="DRAFT")
    notes: Mapped[str | None] = mapped_column(Text)
    confirmed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    confirmed_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    last_modified_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False)

    blocks: Mapped[list["OperationalReportBlock"]] = relationship(
        back_populates="day", cascade="all, delete-orphan", order_by="OperationalReportBlock.sequence"
    )


class OperationalReportBlock(Base):
    __tablename__ = "operational_report_blocks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    day_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("operational_report_days.id", ondelete="CASCADE"), nullable=False, index=True
    )
    source_assignment_id: Mapped[str | None] = mapped_column(String(36), index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    planned_start: Mapped[time] = mapped_column(Time, nullable=False)
    planned_end: Mapped[time] = mapped_column(Time, nullable=False)
    planned_break_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    planned_area: Mapped[str | None] = mapped_column(String(120))
    planned_building: Mapped[str | None] = mapped_column(String(50))
    actual_area_id: Mapped[str | None] = mapped_column(String(36), index=True)
    actual_area_name_snapshot: Mapped[str | None] = mapped_column(String(120))
    actual_building: Mapped[str | None] = mapped_column(String(50))
    notes: Mapped[str | None] = mapped_column(Text)

    day: Mapped[OperationalReportDay] = relationship(back_populates="blocks")
    allocations: Mapped[list["OperationalReportAllocation"]] = relationship(
        back_populates="block", cascade="all, delete-orphan", order_by="OperationalReportAllocation.sequence"
    )


class OperationalReportAllocation(Base):
    __tablename__ = "operational_report_allocations"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    block_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("operational_report_blocks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    customer_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_description_snapshot: Mapped[str] = mapped_column(String(160), nullable=False)
    jupiter_description_snapshot: Mapped[str | None] = mapped_column(Text)
    # Posizione della singola attività: chi si sposta durante lo stesso blocco
    # pianificato rendiconta ogni box dove ha lavorato davvero. ``NULL`` vale
    # "eredita dal blocco" e copre le rendicontazioni precedenti a questo campo.
    actual_area_id: Mapped[str | None] = mapped_column(String(36), index=True)
    actual_area_name_snapshot: Mapped[str | None] = mapped_column(String(120))
    actual_building: Mapped[str | None] = mapped_column(String(50))
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    start_offset_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0, server_default="0")
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text)
    eligible_mapping_ids: Mapped[list] = mapped_column(JSON, nullable=False, default=list, server_default="[]")
    # Tracciamento come nel Planner (``assignments.last_modified_by_name``): il
    # nome è denormalizzato perché resti leggibile anche se l'utente viene
    # disattivato, e i timestamp sono nullable perché le caselle già a DB prima
    # di questo campo non hanno una data vera da mostrare.
    created_by_name: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_modified_by_name: Mapped[str | None] = mapped_column(String(120))
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    block: Mapped[OperationalReportBlock] = relationship(back_populates="allocations")

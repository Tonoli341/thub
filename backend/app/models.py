from datetime import date, datetime, time
from uuid import uuid4

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, JSON, LargeBinary, String, Text, Time, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db import Base
from app.enums import AppRole, AssignmentCause, JustificationApprovalStatus, JustificationType, PlannerScope, UserRole
from app.services.normalization import normalize_phone


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )


class OperationalArea(TimestampMixin, Base):
    __tablename__ = "operational_areas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    area_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_operational: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    buildings: Mapped[list] = mapped_column(JSON, default=list, server_default="[]", nullable=False)

    employees: Mapped[list["Employee"]] = relationship(back_populates="default_operational_area")


class LocalProject(TimestampMixin, Base):
    __tablename__ = "local_projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Employee(TimestampMixin, Base):
    __tablename__ = "employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    tms_id: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    first_name: Mapped[str | None] = mapped_column(String(120))
    last_name: Mapped[str | None] = mapped_column(String(120))
    phone: Mapped[str | None] = mapped_column(String(64))
    phone_from_tms: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    tms_role_code: Mapped[str | None] = mapped_column(String(16), index=True)
    tms_role_description: Mapped[str | None] = mapped_column(String(120), index=True)
    contract_type: Mapped[str | None] = mapped_column(String(120))
    datore_lavoro: Mapped[str | None] = mapped_column(String(255))
    organization_function: Mapped[str | None] = mapped_column(String(120), index=True)
    organization_department: Mapped[str | None] = mapped_column(String(120), index=True)
    organization_role: Mapped[str | None] = mapped_column(String(64), index=True)
    photo_jpeg: Mapped[bytes | None] = mapped_column(LargeBinary)
    default_site: Mapped[str | None] = mapped_column(String(120))
    manager_name: Mapped[str | None] = mapped_column(String(120))
    manager_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    absence_can_request_for_self: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    absence_can_request_for_reports: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    absence_can_request_for_all: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    absence_allowed_role_descriptions: Mapped[str | None] = mapped_column(Text)
    absence_requires_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    absence_approver_1_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    absence_approver_2_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    absence_approver_3_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    config_can_access_planning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config_can_access_organization: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    app_role: Mapped[str | None] = mapped_column(String(16))
    planner_scope: Mapped[str] = mapped_column(String(16), default=PlannerScope.self_.value, nullable=False)
    default_operational_area_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("operational_areas.id"))
    default_immobile: Mapped[str | None] = mapped_column(String(32))
    default_schedule: Mapped[list | None] = mapped_column(JSON)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    default_operational_area: Mapped[OperationalArea | None] = relationship(back_populates="employees")
    manager: Mapped["Employee | None"] = relationship(
        remote_side="Employee.id",
        foreign_keys=[manager_employee_id],
        back_populates="direct_reports",
    )
    direct_reports: Mapped[list["Employee"]] = relationship(
        foreign_keys=[manager_employee_id],
        back_populates="manager",
    )
    absence_approver_1: Mapped["Employee | None"] = relationship(foreign_keys=[absence_approver_1_employee_id], remote_side="Employee.id", post_update=True)
    absence_approver_2: Mapped["Employee | None"] = relationship(foreign_keys=[absence_approver_2_employee_id], remote_side="Employee.id", post_update=True)
    absence_approver_3: Mapped["Employee | None"] = relationship(foreign_keys=[absence_approver_3_employee_id], remote_side="Employee.id", post_update=True)
    assignments: Mapped[list["Assignment"]] = relationship(back_populates="employee")
    justifications: Mapped[list["Justification"]] = relationship(
        back_populates="employee",
        foreign_keys="Justification.employee_id",
    )

    @validates("phone")
    def validate_phone(self, _key: str, value: str | None) -> str | None:
        return normalize_phone(value)


class Site(TimestampMixin, Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    code: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    cause: Mapped[AssignmentCause] = mapped_column(
        Enum(AssignmentCause, name="assignment_cause"),
        nullable=False,
        default=AssignmentCause.presence,
    )
    site: Mapped[str | None] = mapped_column(String(120))
    area: Mapped[str | None] = mapped_column(String(120))
    immobile: Mapped[str | None] = mapped_column(String(32))
    customer: Mapped[str | None] = mapped_column(String(120))
    activity: Mapped[str | None] = mapped_column(String(120))
    notes: Mapped[str | None] = mapped_column(Text)

    employee: Mapped[Employee] = relationship(back_populates="assignments")


class Justification(TimestampMixin, Base):
    __tablename__ = "justifications"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    justification_type: Mapped[JustificationType] = mapped_column(
        Enum(JustificationType, name="justification_type"),
        nullable=False,
    )
    description: Mapped[str | None] = mapped_column(Text)
    start_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    end_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    approval_status: Mapped[JustificationApprovalStatus] = mapped_column(
        Enum(JustificationApprovalStatus, name="justification_approval_status"),
        nullable=False,
        default=JustificationApprovalStatus.approved,
    )
    approval_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    requested_by_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    approver_1_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    approver_2_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    approver_3_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))

    employee: Mapped[Employee] = relationship(back_populates="justifications", foreign_keys=[employee_id])
    requested_by_employee: Mapped[Employee | None] = relationship(foreign_keys=[requested_by_employee_id])
    approver_1_employee: Mapped[Employee | None] = relationship(foreign_keys=[approver_1_employee_id])
    approver_2_employee: Mapped[Employee | None] = relationship(foreign_keys=[approver_2_employee_id])
    approver_3_employee: Mapped[Employee | None] = relationship(foreign_keys=[approver_3_employee_id])


class User(TimestampMixin, Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    display_name: Mapped[str | None] = mapped_column(String(120))
    role: Mapped[UserRole] = mapped_column(Enum(UserRole, name="user_role"), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ldap_employee: Mapped["LdapEmployee | None"] = relationship(back_populates="auth_user")


class LdapEmployee(TimestampMixin, Base):
    __tablename__ = "ldap_employees"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    username: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    display_name: Mapped[str | None] = mapped_column(String(120))
    email: Mapped[str | None] = mapped_column(String(255))
    distinguished_name: Mapped[str | None] = mapped_column(String(255))
    auth_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"), unique=True)
    tms_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    first_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_login_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    auth_user: Mapped[User | None] = relationship(back_populates="ldap_employee")
    tms_employee: Mapped[Employee | None] = relationship()


class Team(TimestampMixin, Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    icon: Mapped[str] = mapped_column(String(16), nullable=False, default="👥")
    color: Mapped[str] = mapped_column(String(16), nullable=False, default="#3b82f6")
    organization_function: Mapped[str | None] = mapped_column(String(120), index=True)
    organization_department: Mapped[str | None] = mapped_column(String(120), index=True)
    team_leader_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    team_leader_2_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    reports_to_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team", cascade="all, delete-orphan")
    team_leader: Mapped[Employee | None] = relationship(foreign_keys=[team_leader_employee_id])
    team_leader_2: Mapped[Employee | None] = relationship(foreign_keys=[team_leader_2_employee_id])
    reports_to_employee: Mapped[Employee | None] = relationship(foreign_keys=[reports_to_employee_id])


class TeamMember(Base):
    __tablename__ = "team_members"
    __table_args__ = (UniqueConstraint("employee_id", name="uq_team_member_employee"),)

    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), primary_key=True)
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id", ondelete="CASCADE"), primary_key=True)

    team: Mapped["Team"] = relationship(back_populates="members")
    employee: Mapped["Employee"] = relationship()


class OrgFunction(TimestampMixin, Base):
    __tablename__ = "org_functions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    responsible_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)

    responsible_employee: Mapped["Employee | None"] = relationship(foreign_keys=[responsible_employee_id])

    @property
    def responsible_employee_name(self) -> str | None:
        return self.responsible_employee.full_name if self.responsible_employee else None


class OrgDepartment(TimestampMixin, Base):
    __tablename__ = "org_departments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    responsible_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"), nullable=True)
    function_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("org_functions.id"), nullable=True)

    responsible_employee: Mapped["Employee | None"] = relationship(foreign_keys=[responsible_employee_id])
    org_function: Mapped["OrgFunction | None"] = relationship(foreign_keys=[function_id])

    @property
    def responsible_employee_name(self) -> str | None:
        return self.responsible_employee.full_name if self.responsible_employee else None

    @property
    def function_name(self) -> str | None:
        return self.org_function.name if self.org_function else None


class ToolChange(TimestampMixin, Base):
    __tablename__ = "tool_changes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    text: Mapped[str] = mapped_column(Text, nullable=False)
    done: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(default=0, nullable=False)


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    actor_name: Mapped[str | None] = mapped_column(String(120))
    action: Mapped[str] = mapped_column(String(120), nullable=False)
    entity: Mapped[str] = mapped_column(String(120), nullable=False)
    detail: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class TimesheetWorker(TimestampMixin, Base):
    __tablename__ = "timesheet_workers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    external_id: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    external_code: Mapped[str | None] = mapped_column(String(120), index=True)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    department: Mapped[str | None] = mapped_column(String(120), index=True)
    company: Mapped[str | None] = mapped_column(String(120))
    role_name: Mapped[str | None] = mapped_column(String(120))
    tms_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    last_synced_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    raw_payload: Mapped[dict] = mapped_column(JSON, default=dict, nullable=False)

    tms_employee: Mapped[Employee | None] = relationship()
    days: Mapped[list["TimesheetDay"]] = relationship(back_populates="worker", cascade="all, delete-orphan")


class TimesheetDay(TimestampMixin, Base):
    __tablename__ = "timesheet_days"
    __table_args__ = (UniqueConstraint("worker_id", "work_date", name="uq_timesheet_day_worker_date"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    worker_id: Mapped[str] = mapped_column(String(36), ForeignKey("timesheet_workers.id", ondelete="CASCADE"), nullable=False, index=True)
    external_day_id: Mapped[str | None] = mapped_column(String(120), index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="COMPILED")
    approval_status: Mapped[str] = mapped_column(String(32), nullable=False, default="PENDING")
    check_in: Mapped[time | None] = mapped_column(Time)
    check_out: Mapped[time | None] = mapped_column(Time)
    break_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    has_anomalies: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    anomaly_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    anomaly_reasons: Mapped[list] = mapped_column(JSON, nullable=False, default=list)
    manual_override: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    supervisor_note: Mapped[str | None] = mapped_column(Text)
    correction_note: Mapped[str | None] = mapped_column(Text)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    approved_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    source_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    worker: Mapped[TimesheetWorker] = relationship(back_populates="days")
    slots: Mapped[list["TimesheetSlot"]] = relationship(back_populates="day", cascade="all, delete-orphan")
    approved_by_user: Mapped[User | None] = relationship(foreign_keys=[approved_by_user_id])


class TimesheetSlot(TimestampMixin, Base):
    __tablename__ = "timesheet_slots"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    day_id: Mapped[str] = mapped_column(String(36), ForeignKey("timesheet_days.id", ondelete="CASCADE"), nullable=False, index=True)
    external_slot_id: Mapped[str | None] = mapped_column(String(120), index=True)
    sequence: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    start_time: Mapped[time | None] = mapped_column(Time)
    end_time: Mapped[time | None] = mapped_column(Time)
    break_minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    minutes: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    project_code: Mapped[str | None] = mapped_column(String(120), index=True)
    project_description: Mapped[str | None] = mapped_column(String(255))
    cost_center_code: Mapped[str | None] = mapped_column(String(120), index=True)
    cost_center_description: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    source_payload: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)

    day: Mapped[TimesheetDay] = relationship(back_populates="slots")


class TimesheetSyncRun(Base):
    __tablename__ = "timesheet_sync_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    trigger_source: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="RUNNING")
    users_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    users_upserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    timesheets_read: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    timesheets_upserted: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    errors_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    error_message: Mapped[str | None] = mapped_column(Text)
    raw_summary: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class TimesheetMapping(TimestampMixin, Base):
    __tablename__ = "timesheet_mappings"
    __table_args__ = (UniqueConstraint("mapping_type", "external_key", name="uq_timesheet_mapping_type_external"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    mapping_type: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    external_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    external_label: Mapped[str | None] = mapped_column(String(255))
    internal_key: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    internal_label: Mapped[str | None] = mapped_column(String(255))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

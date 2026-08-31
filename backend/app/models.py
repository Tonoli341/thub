from datetime import date, datetime, time
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import Boolean, Column, Date, DateTime, Enum, ForeignKey, Integer, JSON, LargeBinary, Numeric, String, Table, Text, Time, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship, validates

from app.db import Base
from app.enums import AssignmentCause, JustificationApprovalStatus, JustificationType, UserRole
from app.services.normalization import normalize_phone


# Colonne che sul database reale sono jsonb, perché è così che le crea
# ensure_schema_updates() in app/db.py. Dichiararle JSON qui le faceva nascere
# `json` su un database nuovo — create_all gira per primo e quei blocchi sono
# tutti dietro `if inspector.has_table(...)` — e `jsonb` su quelli esistenti:
# due ambienti divergenti. La variante tiene il SQLite dei test su JSON.
JSONB_OR_JSON = JSON().with_variant(JSONB, "postgresql")


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
    buildings: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)

    employees: Mapped[list["Employee"]] = relationship(back_populates="default_operational_area")


class TrainingMacroArea(TimestampMixin, Base):
    __tablename__ = "training_macro_areas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    courses: Mapped[list["TrainingCourse"]] = relationship(
        back_populates="macro_area",
        order_by="TrainingCourse.title",
    )


class TrainingCourse(TimestampMixin, Base):
    __tablename__ = "training_courses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(160), unique=True, nullable=False)
    macro_area_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("training_macro_areas.id"), index=True
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    macro_area: Mapped["TrainingMacroArea | None"] = relationship(back_populates="courses")


class LocalProject(TimestampMixin, Base):
    __tablename__ = "local_projects"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    project_code: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class InfinityBillingItem(TimestampMixin, Base):
    __tablename__ = "infinity_billing_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class FieldDefinition(TimestampMixin, Base):
    __tablename__ = "field_definitions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    field_key: Mapped[str] = mapped_column(String(64), unique=True, nullable=False, index=True)
    field_label: Mapped[str] = mapped_column(String(120), nullable=False)
    field_type: Mapped[str] = mapped_column(String(16), nullable=False, default="text")
    options: Mapped[list] = mapped_column(JSON, default=list, server_default="[]", nullable=False)
    # Configurazione dei tipi che non si esprimono con `options`: per
    # "mssql_list" contiene {source, key_column, columns} — mai la SQL, che
    # vive solo nel registro server-side (services/value_list_sources.py).
    config: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    description: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    assignments: Mapped[list["InfinityMapFieldAssignment"]] = relationship(back_populates="field_definition")


class InfinityBillingCustomerSupplierMap(TimestampMixin, Base):
    __tablename__ = "infinity_billing_customer_supplier_map"
    __table_args__ = (
        # Lo stesso cliente sulla stessa voce Infinity va rendicontato su piu
        # aree e immobili (es. Dronero TONOLI EXTRA e Rossana TONOLI EXTRA):
        # area e immobili fanno quindi parte dell'identita dell'incrocio.
        UniqueConstraint(
            "infinity_billing_item_id",
            "customer_supplier_code",
            "jupiter_description",
            "operational_area_id",
            "buildings",
            name="uq_infinity_billing_customer_supplier_map_pair",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    infinity_billing_item_id: Mapped[str] = mapped_column(String(36), ForeignKey("infinity_billing_items.id"), nullable=False, index=True)
    customer_supplier_code: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    customer_supplier_description: Mapped[str] = mapped_column(String(160), nullable=False)
    jupiter_description: Mapped[str | None] = mapped_column(Text)
    operational_area_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("operational_areas.id"))
    # Qui la variante non è solo coerenza: buildings fa parte del vincolo UNIQUE
    # definito sopra e Postgres non sa costruire un indice B-tree su `json` (il
    # tipo non ha operatore di uguaglianza). Con JSON, create_all fallisce su un
    # database nuovo e il backend non parte affatto.
    buildings: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    infinity_billing_item: Mapped["InfinityBillingItem"] = relationship()
    operational_area: Mapped["OperationalArea | None"] = relationship()
    field_assignments: Mapped[list["InfinityMapFieldAssignment"]] = relationship(
        back_populates="map",
        cascade="all, delete-orphan",
        order_by="InfinityMapFieldAssignment.sort_order",
    )

    @property
    def infinity_billing_item_name(self) -> str | None:
        return self.infinity_billing_item.name if self.infinity_billing_item else None

    @property
    def operational_area_name(self) -> str | None:
        return self.operational_area.name if self.operational_area else None


class InfinityMapFieldAssignment(TimestampMixin, Base):
    __tablename__ = "infinity_map_field_assignments"
    __table_args__ = (
        UniqueConstraint("map_id", "field_definition_id", name="uq_infinity_map_field_assignment"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    map_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("infinity_billing_customer_supplier_map.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    field_definition_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("field_definitions.id"), nullable=False, index=True
    )
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    map: Mapped["InfinityBillingCustomerSupplierMap"] = relationship(back_populates="field_assignments")
    field_definition: Mapped["FieldDefinition"] = relationship(back_populates="assignments")


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
    absence_can_view_all: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    absence_can_edit_balances: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    absence_allowed_role_descriptions: Mapped[str | None] = mapped_column(Text)
    absence_requires_approval: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    absence_approver_1_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    absence_approver_2_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    absence_approver_3_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    config_can_access_planning: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config_can_access_organization: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config_can_access_timesheets: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config_can_access_workloads: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config_can_access_expirations: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    config_expirations_scope: Mapped[str] = mapped_column(String(16), default="all", nullable=False)
    config_can_access_deliveries: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    config_can_access_maintenance: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    app_role: Mapped[str | None] = mapped_column(String(16))
    planner_access_level: Mapped[str | None] = mapped_column(String(32))
    default_operational_area_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("operational_areas.id"))
    default_immobile: Mapped[str | None] = mapped_column(String(32))
    default_schedule: Mapped[list | None] = mapped_column(JSONB_OR_JSON)
    birth_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    local_user_username: Mapped[str | None] = mapped_column(String(120), index=True)
    local_user_password_hash: Mapped[str | None] = mapped_column(Text)
    local_user_password_expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    local_user_password_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    is_direttivo: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

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
    equipment_deliveries: Mapped[list["EquipmentDelivery"]] = relationship(back_populates="employee")
    device_deliveries: Mapped[list["DeviceDelivery"]] = relationship(back_populates="employee")
    absence_balance: Mapped["EmployeeAbsenceBalance | None"] = relationship(
        back_populates="employee",
        cascade="all, delete-orphan",
        uselist=False,
    )

    @validates("phone")
    def validate_phone(self, _key: str, value: str | None) -> str | None:
        return normalize_phone(value)


class EmployeeAbsenceBalance(TimestampMixin, Base):
    __tablename__ = "employee_absence_balances"

    employee_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("employees.id", ondelete="CASCADE"),
        primary_key=True,
    )
    permission_hours: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    vacation_days: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0, nullable=False)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    updated_by_name: Mapped[str | None] = mapped_column(String(120))

    employee: Mapped["Employee"] = relationship(back_populates="absence_balance")


class EmployeeAbsenceBalanceStatus(TimestampMixin, Base):
    __tablename__ = "employee_absence_balance_status"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    updated_through: Mapped[date | None] = mapped_column(Date)
    updated_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    updated_by_name: Mapped[str | None] = mapped_column(String(120))


class Site(TimestampMixin, Base):
    __tablename__ = "sites"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    code: Mapped[str | None] = mapped_column(String(32), unique=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)


class SizeGroup(TimestampMixin, Base):
    __tablename__ = "size_groups"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(80), unique=True, nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    options: Mapped[list["SizeOption"]] = relationship(
        back_populates="group",
        order_by="SizeOption.sort_order",
        cascade="all, delete-orphan",
    )


class SizeOption(TimestampMixin, Base):
    __tablename__ = "size_options"
    __table_args__ = (UniqueConstraint("group_id", "value", name="uq_size_option_group_value"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    group_id: Mapped[str] = mapped_column(String(36), ForeignKey("size_groups.id", ondelete="CASCADE"), nullable=False, index=True)
    value: Mapped[str] = mapped_column(String(40), nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    group: Mapped["SizeGroup"] = relationship(back_populates="options")


equipment_item_sizes = Table(
    "equipment_item_sizes",
    Base.metadata,
    Column("item_id", String(36), ForeignKey("equipment_items.id", ondelete="CASCADE"), primary_key=True),
    Column("size_option_id", String(36), ForeignKey("size_options.id", ondelete="CASCADE"), primary_key=True),
)


class EquipmentItem(TimestampMixin, Base):
    __tablename__ = "equipment_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    name: Mapped[str] = mapped_column(String(120), nullable=False, index=True)
    category: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    deliveries: Mapped[list["EquipmentDelivery"]] = relationship(back_populates="item")
    available_size_options: Mapped[list["SizeOption"]] = relationship("SizeOption", secondary=equipment_item_sizes)


class EquipmentDelivery(TimestampMixin, Base):
    __tablename__ = "equipment_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    item_id: Mapped[str] = mapped_column(String(36), ForeignKey("equipment_items.id"), nullable=False, index=True)
    item_name: Mapped[str] = mapped_column(String(120), nullable=False)
    item_category: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    item_size: Mapped[str | None] = mapped_column(String(40))
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    delivered_by: Mapped[str | None] = mapped_column(String(120))
    delivered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    signature_b64: Mapped[str] = mapped_column(Text, nullable=False)

    employee: Mapped[Employee] = relationship(back_populates="equipment_deliveries")
    item: Mapped[EquipmentItem] = relationship(back_populates="deliveries")


class DeviceAsset(TimestampMixin, Base):
    __tablename__ = "device_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_type: Mapped[str] = mapped_column(String(30), nullable=False, index=True)
    brand: Mapped[str | None] = mapped_column(String(80))
    model: Mapped[str | None] = mapped_column(String(80))
    serial_number: Mapped[str | None] = mapped_column(String(120), index=True)
    imei: Mapped[str | None] = mapped_column(String(40))
    iccid: Mapped[str | None] = mapped_column(String(40))
    phone_number: Mapped[str | None] = mapped_column(String(30))
    notes: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ninja_device_id: Mapped[str | None] = mapped_column(String(64), index=True)
    system_name: Mapped[str | None] = mapped_column(String(160))
    node_class: Mapped[str | None] = mapped_column(String(60))

    deliveries: Mapped[list["DeviceDelivery"]] = relationship(back_populates="device")


class DeviceDelivery(TimestampMixin, Base):
    __tablename__ = "device_deliveries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    device_id: Mapped[str] = mapped_column(String(36), ForeignKey("device_assets.id"), nullable=False, index=True)
    redelivered_to_delivery_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("device_deliveries.id"), index=True)
    device_label: Mapped[str] = mapped_column(String(160), nullable=False)
    delivered_by: Mapped[str | None] = mapped_column(String(120))
    delivered_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    returned_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    return_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), index=True)
    notes: Mapped[str | None] = mapped_column(Text)
    signature_b64: Mapped[str | None] = mapped_column(Text)
    # Fonte dell'ultima firma di consegna: "tablet" (raccolta in presenza) o "web"
    # (firmata dal dipendente autenticato dalla pagina "Le mie consegne").
    signature_source: Mapped[str | None] = mapped_column(String(20))
    signed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    signature_requested_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    return_signature_b64: Mapped[str | None] = mapped_column(Text)

    employee: Mapped[Employee] = relationship(back_populates="device_deliveries")
    device: Mapped[DeviceAsset] = relationship(back_populates="deliveries")


class DeviceDeliveryPolicy(TimestampMixin, Base):
    """Policy (es. Information Security) che il dipendente deve leggere prima di
    firmare la consegna di un dispositivo IT. Riga unica, contenuto HTML incollato
    dall'IT nel tab Consegne > Dispositivi IT > Policy."""

    __tablename__ = "device_delivery_policies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    title: Mapped[str] = mapped_column(String(200), nullable=False, default="Information Security Tonoli")
    content_html: Mapped[str] = mapped_column(Text, nullable=False)
    updated_by: Mapped[str | None] = mapped_column(String(120))


class Assignment(TimestampMixin, Base):
    __tablename__ = "assignments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    break_start: Mapped[time | None] = mapped_column(Time)
    break_end: Mapped[time | None] = mapped_column(Time)
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
    workload: Mapped[str | None] = mapped_column(Text)
    training_course_id: Mapped[str | None] = mapped_column(
        String(36), ForeignKey("training_courses.id"), index=True
    )
    last_modified_by_name: Mapped[str | None] = mapped_column(String(120))

    employee: Mapped[Employee] = relationship(back_populates="assignments")
    training_course: Mapped["TrainingCourse | None"] = relationship()


class PlannerDayAudit(TimestampMixin, Base):
    __tablename__ = "planner_day_audits"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    work_date: Mapped[date] = mapped_column(Date, nullable=False, unique=True)
    first_copied_from_date: Mapped[date | None] = mapped_column(Date)
    first_copied_by_name: Mapped[str | None] = mapped_column(String(120))
    first_copied_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    last_modified_by_name: Mapped[str | None] = mapped_column(String(120))
    last_modified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


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
    # tracciabilità diretta sulla richiesta: chi l'ha materialmente inserita e chi ha
    # deciso. decided_by_employee_id/decided_by_user_id sono i riferimenti "propri"
    # a chi ha deciso quando l'identità è risolvibile (dipendente TMS o utente
    # autenticato); decided_by_name resta come fallback testuale denormalizzato
    # perché copre anche i casi senza riferimento risolvibile: utenti portale/LDAP
    # senza dipendente collegato e le approvazioni via link email.
    created_by_name: Mapped[str | None] = mapped_column(String(255))
    decided_by_name: Mapped[str | None] = mapped_column(String(255))
    decided_by_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    decided_by_user_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("users.id"))
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))

    employee: Mapped[Employee] = relationship(back_populates="justifications", foreign_keys=[employee_id])
    requested_by_employee: Mapped[Employee | None] = relationship(foreign_keys=[requested_by_employee_id])
    approver_1_employee: Mapped[Employee | None] = relationship(foreign_keys=[approver_1_employee_id])
    approver_2_employee: Mapped[Employee | None] = relationship(foreign_keys=[approver_2_employee_id])
    approver_3_employee: Mapped[Employee | None] = relationship(foreign_keys=[approver_3_employee_id])
    decided_by_employee: Mapped[Employee | None] = relationship(foreign_keys=[decided_by_employee_id])
    decided_by_user: Mapped["User | None"] = relationship(foreign_keys=[decided_by_user_id])


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
    last_ad_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
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
    workload_owner_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    operational_reporting_owner_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))
    operational_reporting_notifications_enabled: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, server_default="false")
    operational_reporting_email_enabled: Mapped[bool] = mapped_column(
        Boolean, default=False, nullable=False, server_default="false"
    )
    operational_reporting_last_email_date: Mapped[date | None] = mapped_column(Date)

    members: Mapped[list["TeamMember"]] = relationship(back_populates="team", cascade="all, delete-orphan")
    team_leader: Mapped[Employee | None] = relationship(foreign_keys=[team_leader_employee_id])
    team_leader_2: Mapped[Employee | None] = relationship(foreign_keys=[team_leader_2_employee_id])
    reports_to_employee: Mapped[Employee | None] = relationship(foreign_keys=[reports_to_employee_id])
    workload_owner: Mapped[Employee | None] = relationship(foreign_keys=[workload_owner_employee_id])
    operational_reporting_owner: Mapped[Employee | None] = relationship(
        foreign_keys=[operational_reporting_owner_employee_id]
    )


class TeamDailyNote(TimestampMixin, Base):
    __tablename__ = "team_daily_notes"
    __table_args__ = (UniqueConstraint("team_id", "work_date", name="uq_team_daily_note"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id", ondelete="CASCADE"), nullable=False, index=True)
    work_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    workload: Mapped[str | None] = mapped_column(Text)
    table_rows: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)
    owner_employee_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("employees.id"))

    team: Mapped["Team"] = relationship()
    owner_employee: Mapped[Employee | None] = relationship(foreign_keys=[owner_employee_id])

    @property
    def owner_employee_name(self) -> str | None:
        return self.owner_employee.full_name if self.owner_employee else None


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


class AppSetting(TimestampMixin, Base):
    """Impostazioni applicative modificabili a caldo dalla GUI.

    Chiave/valore volutamente generico: il `.env` resta per la configurazione
    infrastrutturale (database, LDAP, chiavi), qui vive ciò che un
    amministratore deve poter cambiare senza riavviare il backend. I valori
    booleani sono serializzati come "true"/"false"; i segreti sono cifrati da
    `app.services.crypto` prima di arrivare in questa colonna.
    """

    __tablename__ = "app_settings"

    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str | None] = mapped_column(Text)
    updated_by: Mapped[str | None] = mapped_column(String(120))


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


class ActivityRecord(Base):
    __tablename__ = "activity_records"
    __table_args__ = (
        UniqueConstraint("employee_id", "mapping_id", "started_at", name="uq_activity_employee_mapping_start"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    mapping_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    operational_area_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    building: Mapped[str | None] = mapped_column(String(20), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    ended_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    duration_seconds: Mapped[int] = mapped_column(Integer, nullable=False)
    field_values: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    employee: Mapped["Employee"] = relationship(foreign_keys=[employee_id])


class ActiveActivity(Base):
    """Stato di un'attività in corso (timer realtime) per un dipendente.

    Un dipendente può avere più attività attive in parallelo, ognuna con il
    proprio timer/pausa indipendente: il backend è il punto di verità, così
    l'app mobile può ricostruirle dopo chiusura/riapertura o perdita di
    connessione. Vincolo di unicità su (employee_id, mapping_id, conflict_key):
    sullo stesso incrocio possono convivere più timer solo se i campi
    obbligatori hanno valori diversi (conflict_key, vedi
    services.active_activities). Alla chiusura la riga viene convertita in un
    ActivityRecord ed eliminata da qui.
    """

    __tablename__ = "active_activities"
    __table_args__ = (
        UniqueConstraint(
            "employee_id",
            "mapping_id",
            "conflict_key",
            name="uq_active_activity_employee_mapping_conflict",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    mapping_id: Mapped[str] = mapped_column(String(36), nullable=False)
    conflict_key: Mapped[str] = mapped_column(String(64), nullable=False, default="", server_default="")
    operational_area_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    building: Mapped[str | None] = mapped_column(String(20), nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    paused_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    pause_seconds: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    field_values: Mapped[dict] = mapped_column(JSON, nullable=False, default=dict)
    client_token: Mapped[str | None] = mapped_column(String(64), nullable=True)
    last_heartbeat_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    employee: Mapped["Employee"] = relationship(foreign_keys=[employee_id])


class NinjaOneTicket(TimestampMixin, Base):
    """Ticket aperti da T-Hub verso NinjaOne (services/ninjaone.py::create_ticket).
    Traccia solo lo stato all'apertura: non c'è polling né webhook di aggiornamento."""

    __tablename__ = "ninjaone_tickets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    ninja_ticket_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    subject: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    priority: Mapped[str] = mapped_column(String(32), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    requested_by_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)

    requested_by: Mapped["Employee"] = relationship(foreign_keys=[requested_by_id])


class DailyRecord(Base):
    __tablename__ = "daily_records"
    __table_args__ = (
        UniqueConstraint("employee_id", "date", name="uq_daily_record_employee_date"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    employee_id: Mapped[str] = mapped_column(String(36), ForeignKey("employees.id"), nullable=False, index=True)
    operational_area_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    building: Mapped[str | None] = mapped_column(String(50), nullable=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    ended_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    pauses: Mapped[list] = mapped_column(JSONB_OR_JSON, nullable=False, default=list, server_default="[]")
    work_seconds: Mapped[int | None] = mapped_column(Integer)
    pause_seconds: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    employee: Mapped["Employee"] = relationship(foreign_keys=[employee_id])

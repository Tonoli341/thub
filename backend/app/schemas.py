from datetime import date, datetime, time
from decimal import Decimal
# Alias per annotare un campo che si chiama a sua volta `date`: con un valore di
# default Python lega il nome nel namespace della classe prima di valutare
# l'annotazione, quindi `date | None` risolverebbe `date` a None (TypeError).
from datetime import date as _date
from typing import Literal

import json as _json

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.enums import AssignmentCause, JustificationApprovalStatus, JustificationType, UserRole


class OperationalAreaBuilding(BaseModel):
    code: str = Field(min_length=1, max_length=32)
    visible_in_planner: bool = True
    visible_in_reporting: bool = True

    @field_validator("code")
    @classmethod
    def _normalize_code(cls, v: str) -> str:
        return v.strip().upper()


def _coerce_area_buildings(v: object) -> list:
    """Coercizione buildings: accetta JSON string, lista di stringhe (formato
    storico) o lista di oggetti; le stringhe diventano oggetti con flag a True."""
    if isinstance(v, str):
        v = _json.loads(v)
    if v is None:
        return []
    return [{"code": entry} if isinstance(entry, str) else entry for entry in v]


class OperationalAreaBase(BaseModel):
    area_code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    is_active: bool = True
    is_operational: bool = True
    buildings: list[OperationalAreaBuilding] = []

    @field_validator("buildings", mode="before")
    @classmethod
    def _coerce_buildings(cls, v: object) -> list:
        return _coerce_area_buildings(v)


class OperationalAreaCreate(OperationalAreaBase):
    pass


class OperationalAreaUpdate(BaseModel):
    area_code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    is_active: bool | None = None
    is_operational: bool | None = None
    buildings: list[OperationalAreaBuilding] | None = None

    @field_validator("buildings", mode="before")
    @classmethod
    def _coerce_buildings(cls, v: object) -> list | None:
        return None if v is None else _coerce_area_buildings(v)


class OperationalAreaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    area_code: str
    name: str
    description: str | None
    is_active: bool
    is_operational: bool
    buildings: list[OperationalAreaBuilding] = []
    created_at: datetime
    updated_at: datetime

    @field_validator("buildings", mode="before")
    @classmethod
    def _coerce_buildings(cls, v: object) -> list:
        return _coerce_area_buildings(v)


class TrainingMacroAreaBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True


class TrainingMacroAreaCreate(TrainingMacroAreaBase):
    pass


class TrainingMacroAreaUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None


class TrainingMacroAreaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TrainingCourseBase(BaseModel):
    title: str = Field(min_length=1, max_length=160)
    macro_area_id: str | None = None
    is_active: bool = True


class TrainingCourseCreate(TrainingCourseBase):
    pass


class TrainingCourseUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=160)
    macro_area_id: str | None = None
    is_active: bool | None = None


class TrainingCourseRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    macro_area_id: str | None
    macro_area_name: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TrainingHoursRow(BaseModel):
    employee_id: str
    employee_name: str
    training_course_id: str | None
    course_title: str | None
    macro_area_name: str | None
    hours: float


class TrainingHoursReport(BaseModel):
    start: date
    end: date
    total_hours: float
    rows: list[TrainingHoursRow]


class LocalProjectBase(BaseModel):
    project_code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    is_active: bool = True


class LocalProjectCreate(LocalProjectBase):
    pass


class LocalProjectUpdate(BaseModel):
    project_code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    is_active: bool | None = None


class LocalProjectRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    project_code: str
    name: str
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class InfinityBillingItemBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True


class InfinityBillingItemCreate(InfinityBillingItemBase):
    pass


class InfinityBillingItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None


class InfinityBillingItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime


class InfinityBillingCustomerSupplierMapBase(BaseModel):
    infinity_billing_item_id: str
    customer_supplier_code: str = Field(min_length=1, max_length=64)
    customer_supplier_description: str = Field(min_length=1, max_length=160)
    jupiter_description: str | None = Field(default=None, max_length=500)
    operational_area_id: str | None = None
    buildings: list[str] = []
    is_active: bool = True


class InfinityBillingCustomerSupplierMapCreate(InfinityBillingCustomerSupplierMapBase):
    pass


# ── Field Definitions (libreria globale) ──────────────────────────────────────

FIELD_TYPES = {"text", "number", "date", "select", "mssql_list"}

# Tipi che si configurano con `config` invece che con `options`.
CONFIG_FIELD_TYPES = {"mssql_list"}


class ValueListColumn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    label: str | None = Field(default=None, max_length=120)
    # Nascosta = non mostrata come dettaglio nella value-list. La colonna chiave
    # è sempre mostrata a prescindere da questo flag.
    visible: bool = True


class ValueListConfig(BaseModel):
    """Config di un campo "mssql_list": quale sorgente del registro
    server-side usare, quale colonna è la chiave, quali colonne mostrare.
    Nessuna SQL: quella vive solo in services/value_list_sources.py.
    """

    source: str = Field(min_length=1, max_length=64)
    key_column: str = Field(min_length=1, max_length=128)
    columns: list[ValueListColumn] = []


class FieldDefinitionCreate(BaseModel):
    field_key: str = Field(min_length=1, max_length=64)
    field_label: str = Field(min_length=1, max_length=120)
    field_type: str = Field(default="text")
    options: list[str] = []
    config: ValueListConfig | None = None
    description: str | None = None


class FieldDefinitionUpdate(BaseModel):
    field_key: str | None = Field(default=None, min_length=1, max_length=64)
    field_label: str | None = Field(default=None, min_length=1, max_length=120)
    field_type: str | None = None
    options: list[str] | None = None
    config: ValueListConfig | None = None
    description: str | None = None
    is_active: bool | None = None


class FieldDefinitionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    field_key: str
    field_label: str
    field_type: str
    options: list[str]
    config: ValueListConfig | None = None
    description: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class ValueListSourceRead(BaseModel):
    key: str
    label: str
    params: list[str] = []


class ValueListSourceColumnsRead(BaseModel):
    source: str
    columns: list[str] = []


class ValueListValuesRead(BaseModel):
    """Valori di un campo "mssql_list" per un dato incrocio."""

    source: str
    key_column: str
    columns: list[ValueListColumn] = []
    rows: list[dict[str, str]] = []


# ── Infinity Map Field Assignments ────────────────────────────────────────────

class InfinityMapFieldAssignmentCreate(BaseModel):
    field_definition_id: str
    is_required: bool = False
    sort_order: int = 0


class InfinityMapFieldAssignmentUpdate(BaseModel):
    is_required: bool | None = None
    sort_order: int | None = None


class InfinityMapFieldAssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    map_id: str
    field_definition_id: str
    field_key: str
    field_label: str
    field_type: str
    options: list[str]
    config: ValueListConfig | None = None
    is_required: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_orm_with_def(cls, obj: object) -> "InfinityMapFieldAssignmentRead":
        fd = obj.field_definition  # type: ignore[attr-defined]
        return cls(
            id=obj.id,  # type: ignore[attr-defined]
            map_id=obj.map_id,  # type: ignore[attr-defined]
            field_definition_id=obj.field_definition_id,  # type: ignore[attr-defined]
            field_key=fd.field_key,
            field_label=fd.field_label,
            field_type=fd.field_type,
            options=list(fd.options or []),
            config=ValueListConfig.model_validate(fd.config) if fd.config else None,
            is_required=obj.is_required,  # type: ignore[attr-defined]
            sort_order=obj.sort_order,  # type: ignore[attr-defined]
            created_at=obj.created_at,  # type: ignore[attr-defined]
            updated_at=obj.updated_at,  # type: ignore[attr-defined]
        )


class InfinityMapFieldAssignmentsBulkReplace(BaseModel):
    assignments: list[InfinityMapFieldAssignmentCreate] = []


class InfinityBillingCustomerSupplierMapUpdate(BaseModel):
    infinity_billing_item_id: str | None = None
    customer_supplier_code: str | None = Field(default=None, min_length=1, max_length=64)
    customer_supplier_description: str | None = Field(default=None, min_length=1, max_length=160)
    jupiter_description: str | None = Field(default=None, max_length=500)
    operational_area_id: str | None = None
    buildings: list[str] | None = None
    is_active: bool | None = None


class InfinityBillingCustomerSupplierMapRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    infinity_billing_item_id: str
    infinity_billing_item_name: str | None = None
    customer_supplier_code: str
    customer_supplier_description: str
    jupiter_description: str | None = None
    operational_area_id: str | None = None
    operational_area_name: str | None = None
    buildings: list[str] = []
    is_active: bool
    created_at: datetime
    updated_at: datetime
    field_assignments: list["InfinityMapFieldAssignmentRead"] = []

    @field_validator("buildings", mode="before")
    @classmethod
    def _coerce_mapping_buildings(cls, v: object) -> list:
        if isinstance(v, str):
            return _json.loads(v)
        return v if v is not None else []

    @field_validator("field_assignments", mode="before")
    @classmethod
    def _coerce_field_assignments(cls, v: object) -> list:
        if v is None:
            return []
        result = []
        for item in v:
            if isinstance(item, dict):
                result.append(item)
            else:
                fd = item.field_definition
                result.append(
                    dict(
                        id=item.id,
                        map_id=item.map_id,
                        field_definition_id=item.field_definition_id,
                        field_key=fd.field_key,
                        field_label=fd.field_label,
                        field_type=fd.field_type,
                        options=list(fd.options or []),
                        is_required=item.is_required,
                        sort_order=item.sort_order,
                        created_at=item.created_at,
                        updated_at=item.updated_at,
                    )
                )
        return result


class EmployeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tms_id: str
    full_name: str
    first_name: str | None
    last_name: str | None
    phone: str | None
    phone_from_tms: bool
    tms_role_code: str | None
    tms_role_description: str | None
    contract_type: str | None
    datore_lavoro: str | None
    organization_function: str | None
    organization_department: str | None
    organization_role: str | None
    has_photo: bool
    default_site: str | None
    manager_name: str | None
    manager_employee_id: str | None
    manager_employee_name: str | None
    absence_can_request_for_self: bool
    absence_can_request_for_reports: bool
    absence_can_request_for_all: bool
    absence_can_view_all: bool
    absence_can_edit_balances: bool
    absence_allowed_role_descriptions: list[str]
    absence_requires_approval: bool
    absence_approver_1_employee_id: str | None
    absence_approver_1_employee_name: str | None
    absence_approver_2_employee_id: str | None
    absence_approver_2_employee_name: str | None
    absence_approver_3_employee_id: str | None
    absence_approver_3_employee_name: str | None
    config_can_access_planning: bool
    config_can_access_organization: bool
    config_can_access_timesheets: bool
    config_can_access_workloads: bool
    config_can_access_expirations: bool
    config_expirations_scope: Literal["none", "reports", "all"] = "all"
    config_can_access_deliveries: bool
    config_can_access_maintenance: bool
    app_role: str | None
    planner_access_level: str | None = None
    default_operational_area_id: str | None
    default_operational_area_name: str | None
    default_immobile: str | None = None
    default_schedule: list[dict] | None = None
    birth_date: date | None = None
    local_user_username: str | None = None
    local_user_password_expires_at: datetime | None = None
    local_user_password_updated_at: datetime | None = None
    local_user_password_is_expired: bool = True
    is_active: bool
    is_team_leader: bool = False
    has_direct_reports: bool = False
    is_direttivo: bool = False
    created_at: datetime
    updated_at: datetime


class ScheduleDayInput(BaseModel):
    enabled: bool
    start: str | None = None
    end: str | None = None
    break_minutes: int = Field(default=0, ge=0)
    break_start: str | None = None
    break_end: str | None = None


class EmployeeScheduleUpdate(BaseModel):
    default_schedule: list[ScheduleDayInput]


class EmployeeManagerUpdate(BaseModel):
    manager_employee_id: str | None = None


class EmployeeOrganizationUpdate(BaseModel):
    organization_role: str | None = Field(default=None, max_length=64)
    organization_department: str | None = Field(default=None, max_length=120)
    is_direttivo: bool | None = None


class EmployeeAbsencePermissionsUpdate(BaseModel):
    absence_can_request_for_self: bool = True
    absence_can_request_for_reports: bool = False
    absence_can_request_for_all: bool = False
    absence_can_view_all: bool = False
    absence_can_edit_balances: bool = False
    absence_allowed_role_descriptions: list[str] = Field(default_factory=list)
    absence_requires_approval: bool = True
    absence_approver_1_employee_id: str | None = None
    absence_approver_2_employee_id: str | None = None
    absence_approver_3_employee_id: str | None = None


class EmployeeConfigurationPermissionsUpdate(BaseModel):
    config_can_access_planning: bool = False
    config_can_access_organization: bool = False
    config_can_access_timesheets: bool = False
    config_can_access_workloads: bool = True
    config_can_access_expirations: bool = True
    config_expirations_scope: Literal["none", "reports", "all"] | None = None
    config_can_access_deliveries: bool = False
    config_can_access_maintenance: bool = False


class EmployeeRoleUpdate(BaseModel):
    app_role: str | None = None
    planner_access_level: str | None = None


class EmployeeDefaultAreaUpdate(BaseModel):
    default_operational_area_id: str | None = None
    default_immobile: str | None = None


class EmployeePhoneUpdate(BaseModel):
    phone: str | None = Field(default=None, max_length=64)


class EmployeeLocalUserUpdate(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=255)


class EmployeeSyncResult(BaseModel):
    fetched: int
    created: int
    updated: int
    deactivated: int
    synced_at: datetime


class EmployeeExpirationRead(BaseModel):
    code: str
    type_code: str | None
    type_description: str | None
    expiration_date: date | None
    issue_date: date | None
    issuing_authority: str | None
    document_number: str | None


class EmployeeCourseBadge(BaseModel):
    employee_id: str
    antincendio: str  # "valid" | "expiring" | "expired" | "missing"
    preposto: str
    primo_soccorso: str
    rls: str


class EmployeeOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tms_id: str
    full_name: str
    tms_role_code: str | None
    tms_role_description: str | None
    organization_function: str | None = None
    organization_department: str | None = None


class EmployeeMobileRead(BaseModel):
    """Versione ridotta di EmployeeRead per l'app mobile Consegne (auth tablet)."""

    id: str
    full_name: str
    role: str | None = None
    department: str | None = None
    is_active: bool


class PaginatedEmployeesMobile(BaseModel):
    items: list[EmployeeMobileRead]
    total: int
    page: int
    size: int


EquipmentCategory = Literal["vestiario", "dpi", "altro"]


class SignaturePayload(BaseModel):
    image_b64: str = Field(min_length=1)


class EquipmentDeliveryItemCreate(BaseModel):
    item_id: str
    size: str | None = Field(default=None, max_length=40)
    quantity: int = Field(default=1, ge=1)


class EquipmentDeliveryCreate(BaseModel):
    employee_id: str
    items: list[EquipmentDeliveryItemCreate] = Field(min_length=1)
    delivered_by: str | None = Field(default=None, max_length=120)
    delivered_at: datetime | None = None
    notes: str | None = None
    signature: SignaturePayload


class EquipmentDeliveryUpdate(BaseModel):
    delivered_by: str | None = Field(default=None, max_length=120)
    delivered_at: datetime | None = None
    notes: str | None = None
    returned_at: datetime | None = None


class EquipmentDeliveryReturn(BaseModel):
    returned_at: datetime | None = None


class EquipmentDeliveryRead(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    employee_role: str | None
    item_id: str
    item_name: str
    item_category: EquipmentCategory
    item_size: str | None
    quantity: int
    delivered_by: str | None
    delivered_at: datetime
    returned_at: datetime | None
    status: Literal["open", "returned"]
    notes: str | None
    signature_b64: str
    created_at: datetime
    updated_at: datetime


class EquipmentDeliveryListRead(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    employee_role: str | None
    item_id: str
    item_name: str
    item_category: EquipmentCategory
    item_size: str | None
    quantity: int
    delivered_by: str | None
    delivered_at: datetime
    returned_at: datetime | None
    status: Literal["open", "returned"]
    notes: str | None
    created_at: datetime
    updated_at: datetime


class PaginatedEquipmentDeliveries(BaseModel):
    items: list[EquipmentDeliveryRead]
    total: int
    page: int
    size: int


class PaginatedEquipmentDeliveryList(BaseModel):
    items: list[EquipmentDeliveryListRead]
    total: int
    page: int
    size: int


DeviceAssetType = Literal["pc", "smartphone"]


class DeviceAssetCreate(BaseModel):
    asset_type: DeviceAssetType
    brand: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    serial_number: str | None = Field(default=None, max_length=120)
    imei: str | None = Field(default=None, max_length=40)
    iccid: str | None = Field(default=None, max_length=40)
    phone_number: str | None = Field(default=None, max_length=30)
    notes: str | None = None


class DeviceAssetUpdate(BaseModel):
    asset_type: DeviceAssetType | None = None
    brand: str | None = Field(default=None, max_length=80)
    model: str | None = Field(default=None, max_length=80)
    serial_number: str | None = Field(default=None, max_length=120)
    imei: str | None = Field(default=None, max_length=40)
    iccid: str | None = Field(default=None, max_length=40)
    phone_number: str | None = Field(default=None, max_length=30)
    notes: str | None = None
    is_active: bool | None = None


class DeviceAssetRead(BaseModel):
    id: str
    asset_type: DeviceAssetType
    brand: str | None
    model: str | None
    serial_number: str | None
    imei: str | None
    iccid: str | None
    phone_number: str | None
    notes: str | None
    is_active: bool
    source: Literal["ninjaone", "manual"]
    ninja_device_id: str | None
    system_name: str | None
    node_class: str | None
    created_at: datetime
    updated_at: datetime


class DeviceSyncResult(BaseModel):
    fetched: int
    created: int
    updated: int
    synced_at: datetime


class DeviceDeliveryCreate(BaseModel):
    employee_id: str
    device_id: str
    delivered_by: str | None = Field(default=None, max_length=120)
    delivered_at: datetime | None = None
    notes: str | None = None
    signature: SignaturePayload


class DeviceDeliveryAssignmentCreate(BaseModel):
    employee_id: str
    device_id: str
    notes: str | None = None


class DeviceDeliverySign(BaseModel):
    signature: SignaturePayload
    # Richiesto dalla firma web quando esiste una policy pubblicata; il flusso
    # tablet gestisce la conferma di lettura nell'app.
    policy_accepted: bool = False


class DeliveryPolicyRead(BaseModel):
    id: str
    title: str
    content_html: str
    updated_by: str | None
    created_at: datetime
    updated_at: datetime


class DeliveryPolicyUpdate(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    content_html: str = Field(min_length=1)


class DeviceDeliveryReturn(BaseModel):
    returned_at: datetime | None = None


class DeviceDeliveryRead(BaseModel):
    id: str
    employee_id: str
    employee_name: str
    employee_role: str | None
    device_id: str
    device_label: str
    device_asset_type: DeviceAssetType
    device_serial_number: str | None
    delivered_by: str | None
    delivered_at: datetime
    returned_at: datetime | None
    return_requested_at: datetime | None = None
    status: Literal["pending_signature", "open", "pending_return_signature", "returned", "redelivered"]
    is_redelivery: bool = False
    previous_delivery_id: str | None = None
    notes: str | None
    signature_b64: str | None
    signature_source: Literal["tablet", "web"] | None = None
    signed_at: datetime | None = None
    signature_requested_at: datetime | None = None
    return_signature_b64: str | None = None
    created_at: datetime
    updated_at: datetime


class PaginatedDeviceDeliveries(BaseModel):
    items: list[DeviceDeliveryRead]
    total: int
    page: int
    size: int


class SizeOptionRead(BaseModel):
    id: str
    value: str
    sort_order: int


class SizeGroupRead(BaseModel):
    id: str
    name: str
    sort_order: int
    options: list[SizeOptionRead]


class EquipmentItemCreate(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    category: EquipmentCategory
    notes: str | None = None
    available_size_ids: list[str] = Field(default_factory=list)


class EquipmentItemUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=2, max_length=120)
    category: EquipmentCategory | None = None
    notes: str | None = None
    is_active: bool | None = None
    available_size_ids: list[str] | None = None


class EquipmentItemRead(BaseModel):
    id: str
    name: str
    category: EquipmentCategory
    notes: str | None
    is_active: bool
    available_sizes: list[str] = Field(default_factory=list)
    available_size_ids: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class AssignmentBase(BaseModel):
    employee_id: str
    work_date: date
    start_time: time
    end_time: time
    break_start: time | None = None
    break_end: time | None = None
    cause: AssignmentCause = AssignmentCause.presence
    site: str | None = Field(default=None, max_length=120)
    area: str | None = Field(default=None, max_length=120)
    immobile: str | None = Field(default=None, max_length=32)
    customer: str | None = Field(default=None, max_length=120)
    activity: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    workload: str | None = None
    training_course_id: str | None = None


class AssignmentCreate(AssignmentBase):
    copy_source_date: date | None = None


class AssignmentUpdate(BaseModel):
    start_time: time | None = None
    end_time: time | None = None
    break_start: time | None = None
    break_end: time | None = None
    cause: AssignmentCause | None = None
    site: str | None = Field(default=None, max_length=120)
    area: str | None = Field(default=None, max_length=120)
    immobile: str | None = Field(default=None, max_length=32)
    customer: str | None = Field(default=None, max_length=120)
    activity: str | None = Field(default=None, max_length=120)
    notes: str | None = None
    workload: str | None = None
    training_course_id: str | None = None


class AssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    employee_name: str
    work_date: date
    start_time: time
    end_time: time
    break_start: time | None
    break_end: time | None
    cause: AssignmentCause
    site: str | None
    area: str | None
    immobile: str | None
    customer: str | None
    activity: str | None
    notes: str | None
    workload: str | None
    training_course_id: str | None = None
    training_course_title: str | None = None
    last_modified_by_name: str | None = None
    created_at: datetime
    updated_at: datetime


class PlannerDayAuditRead(BaseModel):
    work_date: date
    first_copied_from_date: date | None = None
    first_copied_by_name: str | None = None
    first_copied_at: datetime | None = None
    last_modified_by_name: str | None = None
    last_modified_at: datetime | None = None


class JustificationBase(BaseModel):
    employee_id: str
    justification_type: JustificationType
    description: str | None = None
    start_date: date
    end_date: date
    start_time: time
    end_time: time


class JustificationCreate(JustificationBase):
    pass


class JustificationUpdate(BaseModel):
    employee_id: str | None = None
    justification_type: JustificationType | None = None
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None


class JustificationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    employee_name: str
    justification_type: JustificationType
    description: str | None
    start_date: date
    end_date: date
    start_time: time
    end_time: time
    approval_status: JustificationApprovalStatus
    approval_required: bool
    requested_by_employee_id: str | None
    requested_by_employee_name: str | None
    approver_1_employee_id: str | None
    approver_1_employee_name: str | None
    approver_2_employee_id: str | None
    approver_2_employee_name: str | None
    approver_3_employee_id: str | None
    approver_3_employee_name: str | None
    requires_my_approval: bool = False
    created_by_name: str | None = None
    decided_by_name: str | None = None
    decided_by_employee_id: str | None = None
    decided_by_user_id: str | None = None
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime



# ── Absence requests (richiesta ferie, local-user Bearer) ─────────────────────
# Vista semplificata dello stesso modello Justification usata dal portale per
# l'"Assenza": tipo sempre FERIE, distinzione "Giorno" (orario custom) / "Giorni"
# (intervallo di giorni interi) gestita lato client come nel portale interno.

class AbsenceRequestCreate(BaseModel):
    description: str | None = None
    start_date: date
    end_date: date
    start_time: time
    end_time: time


class AbsenceRequestUpdate(BaseModel):
    description: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    start_time: time | None = None
    end_time: time | None = None


class AbsenceRequestRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    justification_type: JustificationType = JustificationType.ferie
    description: str | None = None
    start_date: date
    end_date: date
    start_time: time
    end_time: time
    approval_status: JustificationApprovalStatus
    approval_required: bool
    approver_1_employee_name: str | None = None
    approver_2_employee_name: str | None = None
    approver_3_employee_name: str | None = None
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class JustificationApprovalUpdate(BaseModel):
    approval_status: JustificationApprovalStatus


class DashboardAreaPerson(BaseModel):
    """Una persona dentro un'area del Planner, con la fascia oraria di quel turno."""

    employee_id: str
    employee_name: str
    time_range: str | None = None


class DashboardDetail(BaseModel):
    employee_id: str
    employee_name: str
    info: str
    start_time: str | None = None
    end_time: str | None = None
    # Valorizzato solo per le righe che nascono da una giustificazione (assenti di
    # oggi, richieste in attesa): permette alla home di aprire quella richiesta.
    justification_id: str | None = None
    # Valorizzato solo per il raggruppamento per area operativa: chi e' allocato
    # su piu' immobili nella stessa giornata compare in ognuno con il proprio
    # orario, che da "info" (nomi separati da virgola) non si potrebbe ricavare.
    people: list[DashboardAreaPerson] = []


class DashboardBirthdayItem(BaseModel):
    employee_id: str
    employee_name: str
    birth_date: date
    next_birthday: date
    days_remaining: int


class DashboardBirthdaysResponse(BaseModel):
    days: int
    items: list[DashboardBirthdayItem]


class DashboardResponse(BaseModel):
    target_date: date
    total_active_employees: int
    active_by_company: dict[str, int]
    present_count: int
    absent_count: int
    pending_approvals_count: int
    present_detail: list[DashboardDetail]
    present_by_area: list[DashboardDetail] = []
    absent_today_detail: list[DashboardDetail]
    pending_approvals_detail: list[DashboardDetail]


class DashboardExpirationItem(BaseModel):
    employee_id: str
    employee_name: str
    type_description: str | None = None
    document_number: str | None = None
    expiration_date: date
    days_remaining: int


class DashboardExpirationsResponse(BaseModel):
    days: int
    count: int
    items: list[DashboardExpirationItem]


class PersonalAssignmentItem(BaseModel):
    area: str | None
    site: str | None
    immobile: str | None = None
    start_time: str | None
    end_time: str | None


class UpcomingAbsenceItem(BaseModel):
    id: str
    justification_type: str
    start_date: date
    end_date: date
    approval_status: str
    start_time: str | None = None
    end_time: str | None = None


class TeamAbsentItem(BaseModel):
    employee_id: str
    employee_name: str
    justification_type: str
    start_date: date
    end_date: date
    approval_status: str = "approved"
    start_time: str | None = None
    end_time: str | None = None


class TeamAllocationArea(BaseModel):
    area: str
    employees: list[dict]  # [{"id": str, "name": str}]
    employee_names: list[str]  # kept for backwards compat
    count: int


class MyDashboardResponse(BaseModel):
    today_assignments: list[PersonalAssignmentItem] = []
    upcoming_absences: list[UpcomingAbsenceItem] = []
    pending_count: int = 0
    team_size: int = 0
    team_absent_today: list[TeamAbsentItem] = []
    team_allocations: list[TeamAllocationArea] = []


class ApproverRequestItem(BaseModel):
    justification_id: str
    employee_id: str
    employee_name: str
    justification_type: str
    start_date: date
    end_date: date
    start_time: str | None = None
    end_time: str | None = None
    approval_status: str
    created_by_name: str | None = None
    decided_by_name: str | None = None
    decided_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class ApproverDashboardResponse(BaseModel):
    pending_requests: list[ApproverRequestItem] = []
    recent_processed: list[ApproverRequestItem] = []


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=255)


class LocalUserValidationRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=255)


class ExternalEmployeeRead(BaseModel):
    id: str
    tms_id: str
    full_name: str
    first_name: str | None = None
    last_name: str | None = None
    phone: str | None = None
    tms_role_code: str | None = None
    tms_role_description: str | None = None
    contract_type: str | None = None
    datore_lavoro: str | None = None
    organization_function: str | None = None
    organization_department: str | None = None
    organization_role: str | None = None
    manager_name: str | None = None
    birth_date: date | None = None
    is_active: bool
    # Deprecati: la webapp operatori non usa più la sede di riferimento del
    # dipendente (area/immobile si scelgono a ogni avvio attività, vedi
    # GET /activity-records/last-location). Mantenuti per retrocompatibilità,
    # rimozione da concordare con il team frontend.
    default_operational_area_id: str | None = None
    default_operational_area_name: str | None = None
    default_immobile: str | None = None


class AuthUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str | None
    role: UserRole
    linked_employee_id: str | None = None
    linked_employee_name: str | None = None
    effective_role: str = "collaboratore"
    is_manager: bool = False
    can_access_planning: bool = False
    can_access_calendar: bool = False
    can_access_organization: bool = False
    can_access_timesheets: bool = False
    can_access_workloads: bool = False
    can_access_expirations: bool = False
    expirations_scope: Literal["none", "reports", "all"] = "none"
    can_access_deliveries: bool = False
    can_access_maintenance: bool = False
    timesheets_scope: str = "team"
    planner_access_level: str | None = None
    absence_scope: str = "self"
    can_edit_absence_balances: bool = False
    is_active: bool
    created_at: datetime
    updated_at: datetime


class EmployeeAbsenceBalanceRead(BaseModel):
    employee_id: str
    employee_name: str
    tms_id: str
    permission_hours: float
    vacation_days: float
    last_modified_at: datetime | None = None
    last_modified_by: str | None = None


class EmployeeAbsenceBalanceUpdate(BaseModel):
    permission_hours: Decimal = Field(default=0, max_digits=10, decimal_places=2)
    vacation_days: Decimal = Field(default=0, max_digits=10, decimal_places=2)


class EmployeeAbsenceBalanceChange(EmployeeAbsenceBalanceUpdate):
    employee_id: str


class EmployeeAbsenceBalanceStatusRead(BaseModel):
    updated_through: date | None = None
    last_modified_at: datetime | None = None
    last_modified_by: str | None = None


class EmployeeAbsenceBalancesCommit(BaseModel):
    updated_through: date
    changes: list[EmployeeAbsenceBalanceChange] = Field(min_length=1)


class EmployeeAbsenceBalancesCommitRead(BaseModel):
    updated_through: date
    balances: list[EmployeeAbsenceBalanceRead]


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AuthUserRead


class LocalUserTeamMember(BaseModel):
    id: str
    tms_id: str
    full_name: str


class LocalUserTeam(BaseModel):
    id: str
    name: str
    icon: str
    color: str
    team_leader_id: str | None = None
    team_leader_name: str | None = None
    members: list[LocalUserTeamMember] = Field(default_factory=list)


class LocalUserValidationResponse(BaseModel):
    authenticated: bool = True
    employee: ExternalEmployeeRead
    team: LocalUserTeam | None = None


class LocalUserTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    authenticated: bool = True
    employee: ExternalEmployeeRead
    team: LocalUserTeam | None = None


class EmployeeListItem(BaseModel):
    tms_id: str
    full_name: str


class LocalUserOperationalAreaOption(BaseModel):
    id: str
    area_code: str
    name: str
    buildings: list[str] = Field(default_factory=list)
    is_default: bool = False


class LocalUserInfinityCrossMappingRow(BaseModel):
    id: str
    infinity_billing_item_id: str
    infinity_billing_item_name: str | None = None
    customer_supplier_code: str
    customer_supplier_description: str
    jupiter_description: str | None = None
    operational_area_id: str | None = None
    operational_area_code: str | None = None
    operational_area_name: str | None = None
    buildings: list[str] = Field(default_factory=list)
    is_active: bool
    field_assignments: list["InfinityMapFieldAssignmentRead"] = Field(default_factory=list)


class LocalUserInfinityCrossMappingsResponse(BaseModel):
    authenticated: bool = True
    employee: ExternalEmployeeRead
    default_operational_area: LocalUserOperationalAreaOption | None = None
    operational_areas: list[LocalUserOperationalAreaOption] = Field(default_factory=list)
    mappings: list[LocalUserInfinityCrossMappingRow] = Field(default_factory=list)


class LocalUserMyInfoResponse(BaseModel):
    employee: ExternalEmployeeRead
    date: date
    today_assignments: list[PersonalAssignmentItem] = Field(default_factory=list)
    upcoming_absences: list[UpcomingAbsenceItem] = Field(default_factory=list)
    pending_count: int = 0


# ── Activity Records ──────────────────────────────────────────────────────────

class ActivityRecordCreate(BaseModel):
    employee_id: str
    mapping_id: str
    operational_area_id: str | None = None
    building: str | None = None
    started_at: datetime
    ended_at: datetime
    duration_seconds: int = Field(ge=1)
    field_values: dict = Field(default_factory=dict)


class ActivityRecordRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    mapping_id: str
    operational_area_id: str | None = None
    building: str | None = None
    started_at: datetime
    ended_at: datetime
    duration_seconds: int
    field_values: dict
    created_at: datetime


class ActivityRecordUpdate(BaseModel):
    operational_area_id: str | None = None
    building: str | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=1)
    field_values: dict | None = None


class ActivityLastLocationRead(BaseModel):
    """Ultima posizione di lavoro dell'operatore (GET /activity-records/last-location).

    Valori grezzi del record più recente (timer aperti inclusi): la validazione
    contro gli incroci correnti è a carico del client. Tutti i campi sono null
    se l'operatore non ha alcuno storico.
    """

    operational_area_id: str | None = None
    operational_area_name: str | None = None
    building: str | None = None
    worked_at: datetime | None = None


class ActivityRecordBulkCreate(BaseModel):
    records: list[ActivityRecordCreate] = Field(min_length=1, max_length=500)


class ActivityRecordBulkResult(BaseModel):
    created: int
    duplicates: int
    errors: list[str] = Field(default_factory=list)


class ActivityRecordAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    employee_name: str | None = None
    mapping_id: str
    mapping_description: str | None = None
    infinity_item_name: str | None = None
    jupiter_description: str | None = None
    operational_area_id: str | None = None
    operational_area_name: str | None = None
    building: str | None = None
    started_at: datetime
    ended_at: datetime
    duration_seconds: int
    field_values: dict
    created_at: datetime


class ActivityMappingHoursRow(BaseModel):
    mapping_id: str
    mapping_description: str | None = None
    infinity_item_name: str | None = None
    jupiter_description: str | None = None
    activity_count: int
    employee_count: int
    total_seconds: int
    total_hours: float


class ActivityEmployeeHoursRow(BaseModel):
    employee_id: str
    employee_name: str | None = None
    activity_count: int
    mapping_count: int
    total_seconds: int
    total_hours: float


class ActivityLocationHoursRow(BaseModel):
    operational_area_id: str | None = None
    operational_area_name: str | None = None
    building: str | None = None
    mapping_id: str
    customer_code: str | None = None
    customer_name: str | None = None
    activity_count: int
    employee_count: int
    total_seconds: int
    total_hours: float


class ActivityRecordStatsResponse(BaseModel):
    total_count: int
    total_seconds: int
    total_hours: float
    employee_count: int
    mapping_count: int
    by_mapping: list[ActivityMappingHoursRow] = Field(default_factory=list)
    by_employee: list[ActivityEmployeeHoursRow] = Field(default_factory=list)
    by_location: list[ActivityLocationHoursRow] = Field(default_factory=list)


# ── Active Activities (timer realtime) ────────────────────────────────────────

class ActiveActivityStart(BaseModel):
    mapping_id: str
    operational_area_id: str | None = None
    building: str | None = None
    field_values: dict = Field(default_factory=dict)
    started_at: datetime | None = None
    client_token: str | None = None


class ActiveActivityUpdate(BaseModel):
    operational_area_id: str | None = None
    building: str | None = None
    field_values: dict | None = None


class ActiveActivityClose(BaseModel):
    ended_at: datetime | None = None
    field_values: dict | None = None


class ActiveActivityRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    mapping_id: str
    operational_area_id: str | None = None
    operational_area_name: str | None = None
    building: str | None = None
    started_at: datetime
    paused_at: datetime | None = None
    pause_seconds: int
    elapsed_seconds: int = 0
    status: str = "running"  # "running" | "paused"
    field_values: dict
    client_token: str | None = None
    last_heartbeat_at: datetime
    created_at: datetime


class ActiveActivityAdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    employee_name: str | None = None
    mapping_id: str
    mapping_description: str | None = None
    infinity_item_name: str | None = None
    operational_area_id: str | None = None
    operational_area_name: str | None = None
    building: str | None = None
    started_at: datetime
    paused_at: datetime | None = None
    pause_seconds: int
    elapsed_seconds: int
    last_heartbeat_at: datetime


# ── Daily Records ─────────────────────────────────────────────────────────────

class PauseEntry(BaseModel):
    started_at: datetime
    ended_at: datetime


class DailyRecordCreate(BaseModel):
    employee_id: str
    operational_area_id: str | None = None
    building: str | None = None
    date: date
    started_at: datetime
    ended_at: datetime | None = None
    pauses: list[PauseEntry] = Field(default_factory=list)
    work_seconds: int | None = None
    pause_seconds: int | None = None


class DailyRecordUpdate(BaseModel):
    operational_area_id: str | None = None
    building: str | None = None
    date: _date | None = None
    started_at: datetime | None = None
    ended_at: datetime | None = None
    # Quando `pauses` è presente diventa la fonte di verità: il backend ricalcola
    # `pause_seconds` e `work_seconds` dagli intervalli, ignorando i totali inviati.
    pauses: list[PauseEntry] | None = None
    work_seconds: int | None = Field(default=None, ge=0)
    pause_seconds: int | None = Field(default=None, ge=0)


class DailyRecordCreateResponse(BaseModel):
    id: str
    date: date


class DailyRecordRead(BaseModel):
    id: str
    employee_id: str
    employee_name: str | None = None
    operational_area_id: str | None = None
    operational_area_name: str | None = None
    building: str | None = None
    date: date
    started_at: datetime
    ended_at: datetime | None = None
    pauses: list[PauseEntry] = Field(default_factory=list)
    work_seconds: int | None = None
    pause_seconds: int | None = None
    created_at: datetime


class LdapEmployeeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    username: str
    display_name: str | None
    email: str | None
    distinguished_name: str | None
    auth_user_id: str | None
    tms_employee_id: str | None
    tms_employee_name: str | None
    first_login_at: datetime | None
    last_login_at: datetime | None
    is_active: bool
    is_linked_to_tms: bool
    is_login_locked: bool = False
    created_at: datetime
    updated_at: datetime


class LdapEmployeeUnlockResponse(BaseModel):
    username: str
    cleared_keys: int


class LdapEmployeeTmsLinkUpdate(BaseModel):
    tms_employee_id: str | None = None


class TeamBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    icon: str = Field(min_length=1, max_length=16, default="👥")
    color: str = Field(min_length=1, max_length=16, default="#3b82f6")
    organization_function: str | None = Field(default=None, max_length=120)
    organization_department: str | None = Field(default=None, max_length=120)


class TeamCreate(TeamBase):
    pass


class TeamUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, min_length=1, max_length=16)
    color: str | None = Field(default=None, min_length=1, max_length=16)
    organization_function: str | None = Field(default=None, max_length=120)
    organization_department: str | None = Field(default=None, max_length=120)
    team_leader_employee_id: str | None = None
    team_leader_2_employee_id: str | None = None
    reports_to_employee_id: str | None = None
    workload_owner_employee_id: str | None = None
    operational_reporting_owner_employee_id: str | None = None
    operational_reporting_notifications_enabled: bool | None = None
    operational_reporting_email_enabled: bool | None = None


class TeamMemberSummary(BaseModel):
    employee_id: str
    employee_name: str


class TeamRead(BaseModel):
    id: str
    name: str
    icon: str
    color: str
    organization_function: str | None = None
    organization_department: str | None = None
    team_leader_employee_id: str | None = None
    team_leader_employee_name: str | None = None
    team_leader_manager_employee_id: str | None = None
    team_leader_2_employee_id: str | None = None
    team_leader_2_employee_name: str | None = None
    reports_to_employee_id: str | None = None
    reports_to_employee_name: str | None = None
    workload_owner_employee_id: str | None = None
    workload_owner_employee_name: str | None = None
    operational_reporting_owner_employee_id: str | None = None
    operational_reporting_owner_employee_name: str | None = None
    operational_reporting_notifications_enabled: bool = False
    operational_reporting_email_enabled: bool = False
    created_at: datetime
    updated_at: datetime
    members: list[TeamMemberSummary] = Field(default_factory=list)


class TeamMemberAdd(BaseModel):
    employee_id: str


class WorkloadTableRow(BaseModel):
    row_id: str | None = Field(default=None, max_length=36)
    client_supplier_code: str | None = Field(default=None, max_length=64)
    client_supplier: str | None = Field(default=None, max_length=160)
    inbound_count: int = Field(default=0, ge=0)
    outbound_count: int = Field(default=0, ge=0)
    pallet_count: int = Field(default=0, ge=0)
    notes: str | None = None
    warehouse: str | None = Field(default=None, max_length=120)
    customer_code: str | None = Field(default=None, max_length=64)
    customer_name: str | None = Field(default=None, max_length=160)
    supplier_code: str | None = Field(default=None, max_length=64)
    supplier_name: str | None = Field(default=None, max_length=160)
    gesap_booking_id: str | None = Field(default=None, max_length=64)
    gesap_booking_date: date | None = None
    gesap_status: str | None = Field(default=None, max_length=64)
    gesap_locked: bool = False
    last_modified_by: str | None = Field(default=None, max_length=160)
    last_modified_at: datetime | None = None


class GesapWorkloadImportCreate(BaseModel):
    team_id: str = Field(min_length=1, max_length=36)
    work_date: date
    booking_id: str = Field(min_length=1, max_length=64)


class TeamDailyNoteUpsert(BaseModel):
    workload: str | None = None
    rows: list[WorkloadTableRow] | None = None


class TeamDailyNoteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    team_id: str
    work_date: date
    workload: str | None
    rows: list[WorkloadTableRow] = Field(default_factory=list)
    owner_employee_id: str | None = None
    owner_employee_name: str | None = None
    updated_at: datetime

    @field_validator("rows", mode="before")
    @classmethod
    def _coerce_rows(cls, value: object) -> list:
        return value if isinstance(value, list) else []


class WorkloadTeamEntryRead(BaseModel):
    team_id: str
    team_name: str
    team_icon: str
    team_color: str
    team_leader_employee_name: str | None = None
    workload_owner_employee_name: str | None = None
    work_date: date
    workload: str | None = None
    rows: list[WorkloadTableRow] = Field(default_factory=list)
    owner_employee_id: str | None = None
    owner_employee_name: str | None = None
    updated_at: datetime | None = None


class WorkloadCustomerSupplierRead(BaseModel):
    code: str
    description: str


class ToolChangeCreate(BaseModel):
    text: str = Field(min_length=1)


class ToolChangeUpdate(BaseModel):
    text: str | None = Field(default=None, min_length=1)
    done: bool | None = None


class ToolChangeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    text: str
    done: bool
    sort_order: int
    created_at: datetime
    updated_at: datetime


class TimesheetWorkerRead(BaseModel):
    id: str
    external_id: str
    external_code: str | None = None
    full_name: str
    department: str | None = None
    company: str | None = None
    role_name: str | None = None
    is_active: bool


class TimesheetFilterOptionRead(BaseModel):
    value: str
    label: str


class TimesheetSlotInput(BaseModel):
    start_time: time | None = None
    end_time: time | None = None
    break_minutes: int = Field(default=0, ge=0)
    project_code: str | None = Field(default=None, max_length=120)
    project_description: str | None = Field(default=None, max_length=255)
    cost_center_code: str | None = Field(default=None, max_length=120)
    cost_center_description: str | None = Field(default=None, max_length=255)
    notes: str | None = None


class TimesheetSlotRead(TimesheetSlotInput):
    id: str
    sequence: int
    minutes: int


class TimesheetAllocationRead(BaseModel):
    project_code: str | None = None
    project_label: str | None = None
    cost_center_code: str | None = None
    cost_center_label: str | None = None
    minutes: int
    hours: float


class TimesheetDayListRead(BaseModel):
    id: str
    worker_id: str
    worker_name: str
    worker_code: str | None = None
    department: str | None = None
    linked_employee_id: str | None = None
    linked_employee_has_photo: bool = False
    work_date: date
    check_in: time | None = None
    check_out: time | None = None
    break_minutes: int
    total_minutes: int
    total_hours: float
    status: str
    approval_status: str
    has_anomalies: bool
    anomaly_reasons: list[str] = Field(default_factory=list)
    projects: list[str] = Field(default_factory=list)
    cost_centers: list[str] = Field(default_factory=list)
    supervisor_note: str | None = None
    manual_override: bool = False


class TimesheetDetailRead(TimesheetDayListRead):
    worker_external_id: str
    worker_external_code: str | None = None
    company: str | None = None
    role_name: str | None = None
    correction_note: str | None = None
    approved_at: datetime | None = None
    approved_by: str | None = None
    slots: list[TimesheetSlotRead] = Field(default_factory=list)
    day_allocations: list[TimesheetAllocationRead] = Field(default_factory=list)
    week_allocations: list[TimesheetAllocationRead] = Field(default_factory=list)
    month_allocations: list[TimesheetAllocationRead] = Field(default_factory=list)


class TimesheetCorrectionRequest(BaseModel):
    note: str = Field(min_length=1)


class TimesheetApproveRequest(BaseModel):
    note: str | None = None


class TimesheetManualUpdate(BaseModel):
    status: str | None = Field(default=None, max_length=32)
    check_in: time | None = None
    check_out: time | None = None
    break_minutes: int | None = Field(default=None, ge=0)
    supervisor_note: str | None = None
    correction_note: str | None = None
    slots: list[TimesheetSlotInput] = Field(default_factory=list)


class TimesheetFiltersRead(BaseModel):
    workers: list[TimesheetFilterOptionRead] = Field(default_factory=list)
    departments: list[str] = Field(default_factory=list)
    projects: list[TimesheetFilterOptionRead] = Field(default_factory=list)
    cost_centers: list[TimesheetFilterOptionRead] = Field(default_factory=list)
    statuses: list[str] = Field(default_factory=list)
    approval_statuses: list[str] = Field(default_factory=list)


class TimesheetCalendarCellRead(BaseModel):
    date: date
    status: str | None = None
    approval_status: str | None = None
    has_entry: bool
    has_anomalies: bool


class TimesheetCalendarRowRead(BaseModel):
    worker_id: str
    worker_name: str
    worker_code: str | None = None
    department: str | None = None
    days: list[TimesheetCalendarCellRead] = Field(default_factory=list)


class TimesheetKpiItemRead(BaseModel):
    worker_id: str
    worker_name: str
    worker_code: str | None = None
    department: str | None = None
    timesheet_id: str | None = None
    work_date: date
    status: str | None = None
    approval_status: str | None = None
    anomaly_reasons: list[str] = Field(default_factory=list)


class TimesheetDashboardBucketRead(BaseModel):
    count: int
    items: list[TimesheetKpiItemRead] = Field(default_factory=list)
    calendar: list[TimesheetCalendarRowRead] = Field(default_factory=list)


class TimesheetDashboardRead(BaseModel):
    target_date: date
    kpis: dict[str, int]
    buckets: dict[str, TimesheetDashboardBucketRead]


class TimesheetStatsProjectRead(BaseModel):
    project_key: str
    project_label: str
    hours: float
    worker_count: int
    day_count: int


class TimesheetStatsWorkerRead(BaseModel):
    worker_id: str
    worker_name: str
    worker_code: str | None = None
    department: str | None = None
    hours: float
    top_projects: list[dict] = Field(default_factory=list)


class TimesheetStatsRead(BaseModel):
    total_hours: float
    pending_count: int
    anomaly_count: int
    worker_count: int
    project_count: int
    hours_by_project: list[TimesheetStatsProjectRead] = Field(default_factory=list)
    hours_by_worker: list[TimesheetStatsWorkerRead] = Field(default_factory=list)


class TimesheetSyncRunRead(BaseModel):
    id: str
    trigger_source: str
    status: str
    users_read: int
    users_upserted: int
    timesheets_read: int
    timesheets_upserted: int
    errors_count: int
    error_message: str | None = None
    raw_summary: dict = Field(default_factory=dict)
    started_at: datetime
    finished_at: datetime | None = None


class TimesheetWorkerLinkRead(BaseModel):
    id: str
    external_id: str
    external_code: str | None = None
    full_name: str
    department: str | None = None
    company: str | None = None
    role_name: str | None = None
    tms_employee_id: str | None = None
    tms_employee_name: str | None = None
    tms_employee_tms_id: str | None = None
    suggested_employee_id: str | None = None
    suggested_employee_name: str | None = None
    suggested_employee_tms_id: str | None = None
    is_active: bool
    is_linked_to_employee: bool
    last_synced_at: datetime | None = None
    created_at: datetime
    updated_at: datetime


class TimesheetWorkerLinkUpdate(BaseModel):
    tms_employee_id: str | None = None


class TimesheetProjectLinkRead(BaseModel):
    external_key: str
    external_label: str | None = None
    mapping_id: str | None = None
    local_project_id: str | None = None
    local_project_code: str | None = None
    local_project_name: str | None = None
    is_mapped: bool


class TimesheetProjectLinkUpdate(BaseModel):
    local_project_id: str | None = None


class TimesheetCostCenterLinkRead(BaseModel):
    external_key: str
    external_label: str | None = None
    mapping_id: str | None = None
    operational_area_code: str | None = None
    operational_area_name: str | None = None
    is_mapped: bool


class TimesheetCostCenterLinkUpdate(BaseModel):
    operational_area_code: str | None = None


class TimesheetAdminOverviewRead(BaseModel):
    sync_configured: bool
    scheduler_running: bool
    sync_interval_minutes: int
    total_workers: int
    active_workers: int
    total_days: int
    pending_approvals: int
    anomaly_days: int
    unmapped_workers: int
    unmapped_projects: int
    unmapped_cost_centers: int
    last_sync: TimesheetSyncRunRead | None = None


class TimesheetMappingCreate(BaseModel):
    mapping_type: str = Field(min_length=1, max_length=32)
    external_key: str = Field(min_length=1, max_length=120)
    external_label: str | None = Field(default=None, max_length=255)
    internal_key: str = Field(min_length=1, max_length=120)
    internal_label: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    is_active: bool = True


class TimesheetMappingUpdate(BaseModel):
    external_label: str | None = Field(default=None, max_length=255)
    internal_key: str | None = Field(default=None, min_length=1, max_length=120)
    internal_label: str | None = Field(default=None, max_length=255)
    notes: str | None = None
    is_active: bool | None = None


class TimesheetMappingRead(BaseModel):
    id: str
    mapping_type: str
    external_key: str
    external_label: str | None = None
    internal_key: str
    internal_label: str | None = None
    notes: str | None = None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class OrgFunctionBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True
    responsible_employee_id: str | None = None


class OrgFunctionCreate(OrgFunctionBase):
    pass


class OrgFunctionUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    responsible_employee_id: str | None = None


class OrgFunctionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    is_active: bool
    responsible_employee_id: str | None = None
    responsible_employee_name: str | None = None
    created_at: datetime
    updated_at: datetime


class OrgDepartmentBase(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    is_active: bool = True
    responsible_employee_id: str | None = None
    function_id: str | None = None


class OrgDepartmentCreate(OrgDepartmentBase):
    pass


class OrgDepartmentUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    is_active: bool | None = None
    responsible_employee_id: str | None = None
    function_id: str | None = None


class OrgDepartmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    is_active: bool
    responsible_employee_id: str | None = None
    responsible_employee_name: str | None = None
    function_id: str | None = None
    function_name: str | None = None
    created_at: datetime
    updated_at: datetime


class AuditLogRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    user_id: str | None = None
    actor_name: str | None = None
    action: str
    entity: str
    detail: dict
    created_at: datetime


class AuditLogListResponse(BaseModel):
    total: int
    items: list[AuditLogRead]


class Office365IntegrationRead(BaseModel):
    """Stato dell'integrazione Microsoft 365. Il client secret non compare mai:
    ne esce solo la coda (`client_secret_hint`) per farlo riconoscere."""

    enabled: bool
    oof_enabled: bool
    tenant_id: str
    client_id: str
    client_secret_set: bool
    client_secret_hint: str
    oof_use_manager: bool
    oof_fallback_contact: str
    credentials_complete: bool
    oof_active: bool
    # False se il backend gira senza il pacchetto di cifratura: la GUI lo dice
    # invece di far scoprire il problema al primo salvataggio.
    encryption_available: bool
    updated_at: datetime | None = None
    updated_by: str | None = None


class Office365IntegrationUpdate(BaseModel):
    enabled: bool = False
    oof_enabled: bool = False
    tenant_id: str = ""
    client_id: str = ""
    # None = lascia invariato il segreto salvato; "" = cancellalo.
    client_secret: str | None = None
    oof_use_manager: bool = False
    oof_fallback_contact: str = ""

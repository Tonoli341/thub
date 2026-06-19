from datetime import date, datetime, time

import json as _json

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.enums import AssignmentCause, JustificationApprovalStatus, JustificationType, UserRole


class OperationalAreaBase(BaseModel):
    area_code: str = Field(min_length=1, max_length=32)
    name: str = Field(min_length=1, max_length=120)
    description: str | None = None
    is_active: bool = True
    is_operational: bool = True
    buildings: list[str] = []


class OperationalAreaCreate(OperationalAreaBase):
    pass


class OperationalAreaUpdate(BaseModel):
    area_code: str | None = Field(default=None, min_length=1, max_length=32)
    name: str | None = Field(default=None, min_length=1, max_length=120)
    description: str | None = None
    is_active: bool | None = None
    is_operational: bool | None = None
    buildings: list[str] | None = None


class OperationalAreaRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    area_code: str
    name: str
    description: str | None
    is_active: bool
    is_operational: bool
    buildings: list[str] = []
    created_at: datetime
    updated_at: datetime

    @field_validator("buildings", mode="before")
    @classmethod
    def _coerce_buildings(cls, v: object) -> list:
        if isinstance(v, str):
            return _json.loads(v)
        return v if v is not None else []


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
    app_role: str | None
    planner_scope: str
    default_operational_area_id: str | None
    default_operational_area_name: str | None
    default_immobile: str | None = None
    default_schedule: list[dict] | None = None
    is_active: bool
    is_team_leader: bool = False
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


class EmployeeAbsencePermissionsUpdate(BaseModel):
    absence_can_request_for_self: bool = True
    absence_can_request_for_reports: bool = False
    absence_can_request_for_all: bool = False
    absence_allowed_role_descriptions: list[str] = Field(default_factory=list)
    absence_requires_approval: bool = True
    absence_approver_1_employee_id: str | None = None
    absence_approver_2_employee_id: str | None = None
    absence_approver_3_employee_id: str | None = None


class EmployeeConfigurationPermissionsUpdate(BaseModel):
    config_can_access_planning: bool = False
    config_can_access_organization: bool = False


class EmployeeRoleUpdate(BaseModel):
    app_role: str | None = None
    planner_scope: str = "self"


class EmployeeDefaultAreaUpdate(BaseModel):
    default_operational_area_id: str | None = None
    default_immobile: str | None = None


class EmployeePhoneUpdate(BaseModel):
    phone: str | None = Field(default=None, max_length=64)


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


class EmployeeOptionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    tms_id: str
    full_name: str
    tms_role_code: str | None
    tms_role_description: str | None
    organization_function: str | None = None
    organization_department: str | None = None


class AssignmentBase(BaseModel):
    employee_id: str
    work_date: date
    start_time: time
    end_time: time
    cause: AssignmentCause = AssignmentCause.presence
    site: str | None = Field(default=None, max_length=120)
    area: str | None = Field(default=None, max_length=120)
    immobile: str | None = Field(default=None, max_length=32)
    customer: str | None = Field(default=None, max_length=120)
    activity: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class AssignmentCreate(AssignmentBase):
    pass


class AssignmentUpdate(BaseModel):
    start_time: time | None = None
    end_time: time | None = None
    cause: AssignmentCause | None = None
    site: str | None = Field(default=None, max_length=120)
    area: str | None = Field(default=None, max_length=120)
    immobile: str | None = Field(default=None, max_length=32)
    customer: str | None = Field(default=None, max_length=120)
    activity: str | None = Field(default=None, max_length=120)
    notes: str | None = None


class AssignmentRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    employee_id: str
    employee_name: str
    work_date: date
    start_time: time
    end_time: time
    cause: AssignmentCause
    site: str | None
    area: str | None
    immobile: str | None
    customer: str | None
    activity: str | None
    notes: str | None
    created_at: datetime
    updated_at: datetime


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
    created_at: datetime
    updated_at: datetime


class JustificationApprovalUpdate(BaseModel):
    approval_status: JustificationApprovalStatus


class DashboardDetail(BaseModel):
    employee_id: str
    employee_name: str
    info: str


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


class PersonalAssignmentItem(BaseModel):
    area: str | None
    site: str | None
    start_time: str | None
    end_time: str | None


class UpcomingAbsenceItem(BaseModel):
    id: str
    justification_type: str
    start_date: date
    end_date: date
    approval_status: str


class TeamAbsentItem(BaseModel):
    employee_id: str
    employee_name: str
    justification_type: str
    start_date: date
    end_date: date


class TeamAllocationArea(BaseModel):
    area: str
    employee_names: list[str]
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
    approval_status: str
    created_at: datetime
    updated_at: datetime


class ApproverDashboardResponse(BaseModel):
    pending_requests: list[ApproverRequestItem] = []
    recent_processed: list[ApproverRequestItem] = []


class AuthLoginRequest(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=255)


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
    timesheets_scope: str = "team"
    planner_scope: str = "self"
    absence_scope: str = "self"
    is_active: bool
    created_at: datetime
    updated_at: datetime


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
    user: AuthUserRead


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
    created_at: datetime
    updated_at: datetime


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
    created_at: datetime
    updated_at: datetime
    members: list[TeamMemberSummary] = Field(default_factory=list)


class TeamMemberAdd(BaseModel):
    employee_id: str


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

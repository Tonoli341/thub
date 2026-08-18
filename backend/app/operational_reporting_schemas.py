from datetime import date, datetime, time

from pydantic import BaseModel, Field, field_validator


class ReportingPauseInput(BaseModel):
    start: time
    end: time


class ReportingAllocationInput(BaseModel):
    id: str | None = None
    customer_code: str = Field(min_length=1, max_length=64)
    # Facoltativa solo per permettere di modificare vecchie rendicontazioni
    # create prima dell'introduzione del secondo livello Jupiter.
    jupiter_description: str | None = None
    start_offset_minutes: int | None = Field(default=None, ge=0)
    minutes: int = Field(ge=10)
    notes: str | None = None

    @field_validator("minutes", "start_offset_minutes")
    @classmethod
    def ten_minute_steps(cls, value: int | None) -> int | None:
        if value is not None and value % 10:
            raise ValueError("I minuti devono essere multipli di 10.")
        return value


class ReportingBlockInput(BaseModel):
    id: str | None = None
    source_assignment_id: str | None = None
    actual_area_id: str
    actual_building: str | None = None
    notes: str | None = None
    allocations: list[ReportingAllocationInput] = Field(default_factory=list)


class ReportingDaySave(BaseModel):
    employee_id: str
    work_date: date
    actual_start: time
    actual_end: time
    pauses: list[ReportingPauseInput] = Field(default_factory=list)
    notes: str | None = None
    blocks: list[ReportingBlockInput] = Field(default_factory=list)


class ReportingJupiterDescriptionRead(BaseModel):
    description: str
    mapping_ids: list[str] = Field(default_factory=list)


class ReportingCustomerRead(BaseModel):
    code: str
    description: str
    mapping_ids: list[str] = Field(default_factory=list)
    jupiter_descriptions: list[ReportingJupiterDescriptionRead] = Field(default_factory=list)


class ReportingAllocationRead(BaseModel):
    id: str | None = None
    customer_code: str
    customer_description: str
    jupiter_description: str | None = None
    sequence: int = 0
    start_offset_minutes: int = 0
    minutes: int
    notes: str | None = None
    eligible_mapping_ids: list[str] = Field(default_factory=list)


class ReportingBlockRead(BaseModel):
    id: str | None = None
    source_assignment_id: str | None = None
    sequence: int
    planned_start: time
    planned_end: time
    planned_break_minutes: int
    reporting_start: time
    reporting_end: time
    capacity_minutes: int
    planned_area: str | None = None
    planned_building: str | None = None
    actual_area_id: str | None = None
    actual_area_name: str | None = None
    actual_building: str | None = None
    notes: str | None = None
    eligible_customers: list[ReportingCustomerRead] = Field(default_factory=list)
    allocations: list[ReportingAllocationRead] = Field(default_factory=list)
    allocated_minutes: int = 0


class ReportingMemberRead(BaseModel):
    employee_id: str
    employee_name: str
    report_id: str | None = None
    has_planning: bool
    status: str | None = None
    planned_start: time | None = None
    planned_end: time | None = None
    actual_start: time | None = None
    actual_end: time | None = None
    pauses: list[ReportingPauseInput] = Field(default_factory=list)
    notes: str | None = None
    work_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0
    confirmed_at: datetime | None = None
    updated_at: datetime | None = None
    blocks: list[ReportingBlockRead] = Field(default_factory=list)


class ReportingTeamRead(BaseModel):
    team_id: str
    team_name: str
    team_icon: str
    team_color: str
    members: list[ReportingMemberRead] = Field(default_factory=list)


class ReportingDayContextRead(BaseModel):
    work_date: date
    areas: list[dict] = Field(default_factory=list)
    teams: list[ReportingTeamRead] = Field(default_factory=list)


class ReportingDashboardSummaryRead(BaseModel):
    planned_days: int = 0
    reports: int = 0
    not_started: int = 0
    draft: int = 0
    confirmed: int = 0
    planned_minutes: int = 0
    work_minutes: int = 0
    variance_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0
    overtime_minutes: int = 0
    coverage_percent: float = 0
    confirmation_percent: float = 0


class ReportingDashboardTrendRead(BaseModel):
    work_date: date
    planned_days: int = 0
    reports: int = 0
    confirmed: int = 0
    work_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0


class ReportingDashboardWorkflowRowRead(BaseModel):
    employee_id: str
    employee_name: str
    team_id: str | None = None
    team_name: str
    work_date: date
    status: str
    planned_minutes: int = 0
    work_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0
    variance_minutes: int = 0


class ReportingDashboardWorkflowRead(BaseModel):
    expected_minutes: int = 0
    not_started_planned_minutes: int = 0
    saved_planned_minutes: int = 0
    draft_planned_minutes: int = 0
    confirmed_planned_minutes: int = 0
    saved_work_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0
    variance_minutes: int = 0
    rows: list[ReportingDashboardWorkflowRowRead] = Field(default_factory=list)


class ReportingDashboardMemberRead(BaseModel):
    employee_id: str
    employee_name: str
    planned_days: int = 0
    reports: int = 0
    not_started: int = 0
    draft: int = 0
    confirmed: int = 0
    work_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0
    coverage_percent: float = 0


class ReportingDashboardTeamRead(BaseModel):
    team_id: str
    team_name: str
    team_icon: str
    team_color: str
    planned_days: int = 0
    reports: int = 0
    not_started: int = 0
    draft: int = 0
    confirmed: int = 0
    work_minutes: int = 0
    allocated_minutes: int = 0
    uncovered_minutes: int = 0
    coverage_percent: float = 0
    members: list[ReportingDashboardMemberRead] = Field(default_factory=list)


class ReportingDashboardTeamOptionRead(BaseModel):
    team_id: str
    team_name: str
    team_icon: str
    team_color: str


class ReportingDashboardCustomerRead(BaseModel):
    customer_code: str
    customer_description: str
    jupiter_description: str | None = None
    minutes: int = 0
    allocations: int = 0
    employees: int = 0


class ReportingDashboardLocationRead(BaseModel):
    area_id: str | None = None
    area_name: str
    building: str | None = None
    minutes: int = 0
    allocations: int = 0
    employees: int = 0


class ReportingDashboardRead(BaseModel):
    start_date: date
    end_date: date
    selected_team_id: str | None = None
    filters: dict[str, str | None] = Field(default_factory=dict)
    summary: ReportingDashboardSummaryRead
    workflow: ReportingDashboardWorkflowRead = Field(default_factory=ReportingDashboardWorkflowRead)
    available_teams: list[ReportingDashboardTeamOptionRead] = Field(default_factory=list)
    teams: list[ReportingDashboardTeamRead] = Field(default_factory=list)
    trend: list[ReportingDashboardTrendRead] = Field(default_factory=list)
    customers: list[ReportingDashboardCustomerRead] = Field(default_factory=list)
    locations: list[ReportingDashboardLocationRead] = Field(default_factory=list)

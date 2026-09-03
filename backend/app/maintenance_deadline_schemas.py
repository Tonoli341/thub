from datetime import date, datetime

from pydantic import BaseModel, Field

from app.enums import MaintenanceDeadlineRecurrenceBasis


DeadlineUrgency = str  # "regolare" | "in_scadenza" | "urgente" | "scaduta"


class MaintenanceDeadlineRead(BaseModel):
    id: str
    asset_id: str
    asset_internal_code: str
    asset_class_label: str
    asset_type_label: str
    deadline_type: str
    due_date: date
    recurrence_basis: MaintenanceDeadlineRecurrenceBasis | None
    recurrence_days: int | None
    # Soglia a ore contaore: presente solo per scadenze su sottoclassi con
    # tracks_usage_hours=True (vedi manutenzioni.md riga 112).
    due_hours: float | None
    recurrence_hours: int | None
    last_completed_hours: float | None
    # Proiezione calcolata al volo dalle ultime letture contaore (nessuna
    # colonna dedicata): None finché non ci sono almeno due letture "ore" da
    # cui stimare un ritmo d'uso, o se la scadenza non ha una soglia a ore.
    current_hours: float | None
    projected_due_date: date | None
    notice_thresholds_days: list[int]
    last_completed_at: date | None
    postponed_reason: str | None
    is_active: bool
    urgency: DeadlineUrgency


class MaintenanceDeadlineCreate(BaseModel):
    asset_id: str
    deadline_type: str = Field(min_length=1, max_length=120)
    due_date: date
    recurrence_basis: MaintenanceDeadlineRecurrenceBasis | None = None
    recurrence_days: int | None = Field(default=None, gt=0)
    due_hours: float | None = Field(default=None, gt=0)
    recurrence_hours: int | None = Field(default=None, gt=0)
    notice_thresholds_days: list[int] = Field(default_factory=lambda: [30, 15, 7])
    # Data (ed eventuali ore contatore) dell'ultima manutenzione già avvenuta, se
    # la scadenza viene creata in un momento diverso da quello dell'intervento:
    # senza questo dato la baseline delle ore userebbe la lettura contatore
    # corrente, che non corrisponde a quando la manutenzione è stata fatta.
    last_completed_at: date | None = None
    last_completed_hours: float | None = Field(default=None, ge=0)


class MaintenanceDeadlineComplete(BaseModel):
    completed_date: date
    completed_hours: float | None = Field(default=None, ge=0)
    confirm_next_due_date: bool = False
    next_due_date: date | None = None


class MaintenanceDeadlinePostpone(BaseModel):
    new_due_date: date
    reason: str = Field(min_length=1, max_length=500)

import enum


class AssignmentCause(str, enum.Enum):
    presence = "PRESENZA"
    ferie = "FERIE"
    permesso = "PERMESSO"
    malattia = "MALATTIA"
    formazione = "FORMAZIONE"
    trasferta = "TRASFERTA"
    altro = "ALTRO"


class JustificationType(str, enum.Enum):
    ferie = "FERIE"
    permesso = "PERMESSO"
    altro = "ALTRO"


class UserRole(str, enum.Enum):
    admin = "ADMIN"
    planner = "PLANNER"
    manager = "RESPONSABILE"


class AppRole(str, enum.Enum):
    admin = "ADMIN"
    hr = "HR"


class PlannerScope(str, enum.Enum):
    self_ = "self"
    team = "team"
    all_ = "all"


class JustificationApprovalStatus(str, enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"

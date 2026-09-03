import enum


class AssignmentCause(str, enum.Enum):
    presence = "PRESENZA"
    ferie = "FERIE"
    permesso = "PERMESSO"
    malattia = "MALATTIA"
    formazione = "FORMAZIONE"
    visita_idoneita = "VISITA_IDONEITA"
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


class MaintenanceAssetStatus(str, enum.Enum):
    attivo = "attivo"
    in_manutenzione = "in_manutenzione"
    dismesso = "dismesso"
    fuori_servizio = "fuori_servizio"


class MaintenanceFieldType(str, enum.Enum):
    text = "text"
    number = "number"
    date = "date"
    bool_ = "bool"
    select = "select"
    image = "image"
    # Riferimento a un dipendente (select popolata da Employee): usato per
    # l'attributo generico "responsabile", ma disponibile per qualunque
    # campo configurabile ne abbia bisogno.
    employee = "employee"


class MaintenanceDocumentStatus(str, enum.Enum):
    rilasciato = "rilasciato"
    obsoleto = "obsoleto"


class MaintenanceDeadlineRecurrenceBasis(str, enum.Enum):
    da_effettiva = "da_effettiva"
    da_prevista = "da_prevista"

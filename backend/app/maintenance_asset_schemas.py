from datetime import date, datetime

from pydantic import BaseModel, Field, field_validator

from app.enums import MaintenanceAssetStatus, MaintenanceFieldType


CustomFieldValue = str | float | bool | None


class MaintenanceAssetFieldRead(BaseModel):
    id: str
    field_key: str
    label: str
    field_type: MaintenanceFieldType
    is_required: bool
    is_searchable: bool
    options: list[str]
    sort_order: int


class MaintenanceAssetFieldCreate(BaseModel):
    field_key: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=120)
    field_type: MaintenanceFieldType
    is_required: bool = False
    is_searchable: bool = True
    options: list[str] = Field(default_factory=list)
    sort_order: int = 0

    @field_validator("field_key")
    @classmethod
    def validate_field_key(cls, value: str) -> str:
        if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789_" for char in value):
            raise ValueError("La chiave campo può contenere solo lettere minuscole, cifre e underscore.")
        return value


class MaintenanceAssetFieldUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    field_type: MaintenanceFieldType | None = None
    is_required: bool | None = None
    is_searchable: bool | None = None
    options: list[str] | None = None
    sort_order: int | None = None


class MaintenanceAssetTypeRead(BaseModel):
    id: str
    asset_class_id: str
    code: str
    label: str
    icon: str
    is_active: bool
    sort_order: int
    tracks_usage_hours: bool
    fields: list[MaintenanceAssetFieldRead]
    document_type_options: list[str]
    deadline_type_options: list[str]


class MaintenanceAssetTypeCreate(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=120)
    icon: str = Field(default="tools", min_length=1, max_length=40)
    tracks_usage_hours: bool = False

    @field_validator("code")
    @classmethod
    def validate_code(cls, value: str) -> str:
        if any(char not in "abcdefghijklmnopqrstuvwxyz0123456789_" for char in value):
            raise ValueError("Il codice sottoclasse può contenere solo lettere minuscole, cifre e underscore.")
        return value


class MaintenanceAssetTypeUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, min_length=1, max_length=40)
    tracks_usage_hours: bool | None = None
    document_type_options: list[str] | None = None
    deadline_type_options: list[str] | None = None


class MaintenanceAssetClassRead(BaseModel):
    id: str
    family_id: str
    code: str
    label: str
    icon: str
    is_active: bool
    sort_order: int
    fields: list[MaintenanceAssetFieldRead]
    types: list[MaintenanceAssetTypeRead]


class MaintenanceAssetClassCreate(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=120)
    icon: str = Field(default="tools", min_length=1, max_length=40)


class MaintenanceAssetClassUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, min_length=1, max_length=40)


class MaintenanceAssetFamilyRead(BaseModel):
    id: str
    code: str
    label: str
    icon: str
    is_active: bool
    sort_order: int
    classes: list[MaintenanceAssetClassRead]


class MaintenanceAssetFamilyCreate(BaseModel):
    code: str = Field(min_length=1, max_length=60)
    label: str = Field(min_length=1, max_length=120)
    icon: str = Field(default="tools", min_length=1, max_length=40)


class MaintenanceAssetFamilyUpdate(BaseModel):
    label: str | None = Field(default=None, min_length=1, max_length=120)
    icon: str | None = Field(default=None, min_length=1, max_length=40)


class MaintenanceHierarchyReorder(BaseModel):
    """Nuovo ordine per un gruppo di voci con lo stesso genitore (tutte le
    famiglie, oppure tutte le classi di una famiglia, oppure tutte le
    sottoclassi di una classe): lista completa degli id in ordine
    desiderato — il riordino non sposta voci tra genitori diversi."""

    ordered_ids: list[str] = Field(min_length=1)


class MaintenanceAssetRead(BaseModel):
    id: str
    asset_type_id: str
    asset_type_label: str
    asset_class_id: str
    asset_class_label: str
    # Value list della sottoclasse (vedi MaintenanceAssetType.*_options):
    # portate qui per evitare una chiamata separata quando la scheda asset
    # deve popolare la select di upload documento / creazione scadenza.
    document_type_options: list[str]
    deadline_type_options: list[str]
    internal_code: str
    status: MaintenanceAssetStatus
    status_reason: str | None
    main_image_id: str | None
    image_field_ids: dict[str, str]
    custom_fields: dict[str, CustomFieldValue]
    # Nome visualizzato per i campi configurabili di tipo "employee" (es.
    # responsabile): il custom_fields tiene solo l'id, questo dict porta il
    # nome risolto lato server per la UI, chiave = field_key.
    employee_field_names: dict[str, str]
    # Il token in chiaro non è mai qui (vedi MaintenanceAssetQrTokenRead): solo
    # se esiste già, così la UI sceglie tra "Genera QR" e "Rigenera QR".
    has_qr_token: bool
    created_at: datetime
    updated_at: datetime
    # Autore dell'ultima modifica (dall'audit log): valorizzato solo dal
    # dettaglio del singolo asset, non dalle liste — evitare una query per
    # ogni riga di un elenco potenzialmente lungo.
    last_modified_by: str | None = None


class MaintenanceAssetCreate(BaseModel):
    asset_type_id: str
    internal_code: str | None = Field(
        default=None,
        max_length=40,
        description="Codice secondo la codifica interna aziendale; se vuoto viene generato automaticamente.",
    )
    custom_fields: dict[str, CustomFieldValue] = Field(default_factory=dict)


class MaintenanceAssetUpdate(BaseModel):
    status: MaintenanceAssetStatus | None = None
    status_reason: str | None = None
    custom_fields: dict[str, CustomFieldValue] | None = None
    change_reason: str | None = Field(
        default=None,
        description="Motivazione registrata nello storico quando cambiano sede, reparto, responsabile o stato.",
    )


class MaintenanceAssetHistoryRead(BaseModel):
    id: str
    changed_field: str
    old_value: str | None
    new_value: str | None
    reason: str | None
    changed_by: str | None
    changed_at: datetime


class MaintenanceAssetCommentCreate(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


class MaintenanceAssetCommentRead(BaseModel):
    id: str
    text: str
    status: MaintenanceAssetStatus
    status_reason: str | None
    created_by: str | None
    created_at: datetime


class MaintenanceAssetCounterRead(BaseModel):
    id: str
    reading_date: date
    value: float
    unit: str
    recorded_by: str | None
    created_at: datetime
    # Valorizzati solo dall'endpoint di classe (statistiche ore sul parco):
    # la scheda del singolo asset già sa a quale asset appartengono le sue
    # letture, non le ripete qui per non rompere le risposte esistenti.
    asset_id: str | None = None
    asset_internal_code: str | None = None


class MaintenanceAssetCounterCreate(BaseModel):
    reading_date: date
    value: float
    unit: str = Field(min_length=1, max_length=10)


class MaintenanceAssetCounterUpdate(BaseModel):
    reading_date: date
    value: float


class MaintenanceAssetQrTokenRead(BaseModel):
    """Risposta degli endpoint admin di lettura/rigenerazione token QR: unico
    punto in cui il token in chiaro (e l'URL pubblico da stampare sul QR)
    vengono esposti."""

    asset_id: str
    qr_token: str
    public_url_path: str


class MaintenanceDeadlinePublicRead(BaseModel):
    """Scadenza come mostrata nella pagina pubblica del QR: solo tipo e data,
    niente motivazioni di rinvio o soglie di preavviso."""

    deadline_type: str
    due_date: date
    is_active: bool


class MaintenanceAssetPublicFieldRead(BaseModel):
    """Un campo anagrafico configurabile già pronto da mostrare nella pagina
    pubblica: valore grezzo risolto lato server (per i campi "employee" il
    nome del dipendente, non il suo id), così il frontend pubblico — che non
    ha accesso agli endpoint protetti di definizione campo — non deve
    conoscere label/tipo/opzioni per renderizzare qualcosa di leggibile."""

    field_key: str
    label: str
    field_type: str
    value: str | None


class MaintenanceAssetPublicImageRead(BaseModel):
    """Metadati di un'immagine dell'asset esposti pubblicamente: bastano per
    costruire la griglia foto e l'URL del binario (endpoint pubblico dedicato,
    vedi maintenance_assets_public.py)."""

    id: str
    image_kind: str
    slot_key: str
    title: str


class MaintenanceAssetPublicCounterRead(BaseModel):
    reading_date: date
    value: float
    unit: str


class MaintenanceAssetPublicDocumentRead(BaseModel):
    """Metadati minimi del documento mostrati nel QR pubblico: nessun id o
    riferimento al file, quindi il contenuto non è apribile né enumerabile."""

    document_type: str
    notes: str


class MaintenanceAssetPublicNoteRead(BaseModel):
    """Nota libera dell'asset mostrata nel QR pubblico con autore e data,
    senza id o metadati dello snapshot di stato interno."""

    text: str
    created_by: str | None
    created_at: datetime


class MaintenanceAssetPublicRead(BaseModel):
    """Dati esposti dalla pagina pubblica raggiunta scansionando il QR
    dell'asset: sola lettura, senza login.

    Revisione del 2026-09-03 (vedi manutenzioni.md §18): dopo il primo
    rilascio, che escludeva deliberatamente custom_fields/foto/contaore, la
    richiesta esplicita e confermata è stata di allargare la pagina pubblica
    a tutta l'anagrafica dell'asset. Dei documenti vengono esposti solo tipo
    e note, mai id, nome file o contenuto. Sono visibili anche i soli testi
    delle note libere dell'asset con autore e data, ma senza id o metadati
    dello snapshot di stato. Il campo custom_field_values porta i valori già
    risolti (nomi al posto degli id per i campi "employee") invece del dict
    grezzo, per non dover esporre anche gli endpoint di definizione campo."""

    internal_code: str
    asset_type_label: str
    asset_class_label: str
    status: MaintenanceAssetStatus
    status_reason: str | None
    deadlines: list[MaintenanceDeadlinePublicRead]
    custom_field_values: list[MaintenanceAssetPublicFieldRead]
    images: list[MaintenanceAssetPublicImageRead]
    documents: list[MaintenanceAssetPublicDocumentRead]
    notes: list[MaintenanceAssetPublicNoteRead]
    # Presente solo se la sottoclasse traccia le ore/contaore
    # (asset_type.tracks_usage_hours); altrimenti lista vuota.
    counters: list[MaintenanceAssetPublicCounterRead]

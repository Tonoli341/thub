"""Modelli del modulo Manutenzioni — fase 1 (pilota carrelli elevatori).

Modulo isolato da app/models.py per lo stesso motivo di app/maintenance_models.py:
non aggiungere altre righe a un file già segnalato in AGENTS.md come da non
toccare "di passaggio".

Anagrafica configurabile (§5 del documento di analisi requisiti): le classi di
asset e i loro campi extra sono dati, non colonne — MaintenanceAssetField
permette a Operations di dichiarare nuovi attributi senza una migrazione per
ogni nuova classe. I valori dei campi configurabili vivono in
MaintenanceAsset.custom_fields (JSONB indicizzabile), non in una tabella EAV:
con l'ordine di grandezza di asset previsto per il pilota (~100 carrelli) non
serve altro, e si evita una quarta tabella.
"""

from datetime import date, datetime
from decimal import Decimal
from uuid import uuid4

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base
from app.enums import (
    MaintenanceAssetStatus,
    MaintenanceDeadlineRecurrenceBasis,
    MaintenanceDocumentStatus,
    MaintenanceFieldType,
)
from app.models import JSONB_OR_JSON, TimestampMixin


class MaintenanceAssetFamily(TimestampMixin, Base):
    """Famiglia (es. "Sollevamento"): il livello più alto dell'alberatura,
    contenitore stabile di poche classi — stessa natura della classe
    (§1.6/manutenzioni.md), un gradino sopra. Gestita da Admin."""

    __tablename__ = "maintenance_asset_families"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    code: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str] = mapped_column(String(40), default="tools", server_default="tools", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Ordine di visualizzazione scelto a mano in UI (drag & drop): non alfabetico.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    classes: Mapped[list["MaintenanceAssetClass"]] = relationship(
        back_populates="family",
        order_by="MaintenanceAssetClass.sort_order",
        cascade="all, delete-orphan",
    )


class MaintenanceAssetClass(TimestampMixin, Base):
    """Classe (es. "Carrello elevatore"): contenitore stabile, poche voci,
    gestito da Admin, agganciato a una famiglia. Non porta più direttamente i
    campi configurabili — quelli vivono sulla sottoclasse, perché in pratica
    variano anche all'interno della stessa classe (frontale vs retrattile)."""

    __tablename__ = "maintenance_asset_classes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    family_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_asset_families.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(60), unique=True, nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    # Nome di una delle icone SVG del frontend (vedi components/Icon.jsx): usata
    # in sidebar per la voce di menu generata per questa classe.
    icon: Mapped[str] = mapped_column(String(40), default="tools", server_default="tools", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Ordine di visualizzazione scelto a mano in UI (drag & drop): non alfabetico.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)

    family: Mapped["MaintenanceAssetFamily"] = relationship(back_populates="classes")
    types: Mapped[list["MaintenanceAssetType"]] = relationship(
        back_populates="asset_class",
        order_by="MaintenanceAssetType.sort_order",
        cascade="all, delete-orphan",
    )
    fields: Mapped[list["MaintenanceAssetField"]] = relationship(
        back_populates="asset_class",
        order_by="MaintenanceAssetField.sort_order",
        cascade="all, delete-orphan",
        primaryjoin="MaintenanceAssetClass.id == MaintenanceAssetField.asset_class_id",
    )


class MaintenanceAssetType(TimestampMixin, Base):
    """Sottoclasse (es. "Frontale", "Retrattile"): il livello che Operations
    configura liberamente da interfaccia. Ogni asset appartiene a una
    sottoclasse, non direttamente alla classe — la classe si ricava per
    join."""

    __tablename__ = "maintenance_asset_types"
    __table_args__ = (UniqueConstraint("asset_class_id", "code", name="uq_maintenance_asset_type_code"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_class_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_asset_classes.id"), nullable=False)
    code: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    icon: Mapped[str] = mapped_column(String(40), default="tools", server_default="tools", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Ordine di visualizzazione scelto a mano in UI (drag & drop): non alfabetico.
    sort_order: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    # Se True, gli asset di questa sottoclasse espongono la scheda "Ore" e
    # possono avere scadenze a soglia ore oltre che a data (manutenzioni.md
    # riga 112): non tutte le classi hanno un contaore significativo.
    tracks_usage_hours: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    # Value list di tipo documento/scadenza ammessi in upload/creazione per
    # questa sottoclasse: stessa natura di MaintenanceAssetField.options per i
    # campi di tipo "elenco" (JSON di stringhe, editata come testo separato da
    # virgole), non una tabella dedicata — non condivisa tra sottoclassi.
    document_type_options: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)
    deadline_type_options: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)

    asset_class: Mapped["MaintenanceAssetClass"] = relationship(back_populates="types")
    fields: Mapped[list["MaintenanceAssetField"]] = relationship(
        back_populates="asset_type",
        order_by="MaintenanceAssetField.sort_order",
        cascade="all, delete-orphan",
    )


class MaintenanceAssetField(TimestampMixin, Base):
    """Definizione di un campo configurabile, a scelta su una sottoclasse
    (portata, montante, alimentazione... varia anche all'interno della
    stessa classe) oppure sulla classe intera (attributi generici comuni a
    tutte le sottoclasse, es. sito, produttore, modello, numero di serie).
    Esattamente uno tra asset_type_id e asset_class_id è valorizzato.
    `options` è la lista di valori ammessi per i campi di tipo select."""

    __tablename__ = "maintenance_asset_fields"
    __table_args__ = (
        UniqueConstraint("asset_type_id", "field_key", name="uq_maintenance_asset_field_key"),
        UniqueConstraint("asset_class_id", "field_key", name="uq_maintenance_asset_field_class_key"),
        CheckConstraint(
            "(asset_type_id IS NOT NULL AND asset_class_id IS NULL) "
            "OR (asset_type_id IS NULL AND asset_class_id IS NOT NULL)",
            name="ck_maintenance_asset_field_single_scope",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_type_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("maintenance_asset_types.id"))
    asset_class_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("maintenance_asset_classes.id"))
    field_key: Mapped[str] = mapped_column(String(60), nullable=False)
    label: Mapped[str] = mapped_column(String(120), nullable=False)
    field_type: Mapped[MaintenanceFieldType] = mapped_column(
        Enum(MaintenanceFieldType, name="maintenance_field_type"), nullable=False
    )
    is_required: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    is_searchable: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    options: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)
    sort_order: Mapped[int] = mapped_column(Integer, default=0, nullable=False)

    asset_type: Mapped["MaintenanceAssetType | None"] = relationship(back_populates="fields")
    asset_class: Mapped["MaintenanceAssetClass | None"] = relationship(
        back_populates="fields", primaryjoin="MaintenanceAssetField.asset_class_id == MaintenanceAssetClass.id"
    )


class MaintenanceAsset(TimestampMixin, Base):
    __tablename__ = "maintenance_assets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_type_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_asset_types.id"), nullable=False)
    internal_code: Mapped[str] = mapped_column(String(40), unique=True, nullable=False)
    status: Mapped[MaintenanceAssetStatus] = mapped_column(
        Enum(MaintenanceAssetStatus, name="maintenance_asset_status"),
        default=MaintenanceAssetStatus.attivo,
        server_default=MaintenanceAssetStatus.attivo.value,
        nullable=False,
    )
    status_reason: Mapped[str | None] = mapped_column(String(255))
    custom_fields: Mapped[dict] = mapped_column(JSONB_OR_JSON, default=dict, server_default="{}", nullable=False)
    # Colonna legacy di 0018: resta per compatibilità con i database che hanno
    # già applicato la revisione, ma le immagini vivono da 0019 nella tabella
    # maintenance_asset_images e questo riferimento non viene più valorizzato.
    main_image_document_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("maintenance_documents.id"))
    # Token del QR code fisico attaccato all'asset (0020): permanente ma
    # rigenerabile da un admin. NULL finché nessuno lo genera (lazy, non
    # popolato in massa dalla migrazione). Rigenerare sovrascrive il valore:
    # non è calcolato via HMAC stateless proprio per poterlo invalidare così.
    qr_token: Mapped[str | None] = mapped_column(String(64), unique=True)

    asset_type: Mapped["MaintenanceAssetType"] = relationship()


class MaintenanceAssetHistory(Base):
    """Storico di sede/reparto/responsabile/stato: un valore superato non si
    sovrascrive, si registra (§5 e §13 del documento requisiti)."""

    __tablename__ = "maintenance_asset_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_assets.id"), nullable=False, index=True)
    changed_field: Mapped[str] = mapped_column(String(40), nullable=False)
    old_value: Mapped[str | None] = mapped_column(String(255))
    new_value: Mapped[str | None] = mapped_column(String(255))
    reason: Mapped[str | None] = mapped_column(Text)
    changed_by: Mapped[str | None] = mapped_column(String(120))
    changed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MaintenanceAssetCounter(Base):
    """Lettura periodica di chilometri/ore: serie storica, non un campo
    dell'anagrafica (§5)."""

    __tablename__ = "maintenance_asset_counters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_assets.id"), nullable=False, index=True)
    reading_date: Mapped[date] = mapped_column(Date, nullable=False)
    value: Mapped[Decimal] = mapped_column(Numeric(12, 2), nullable=False)
    unit: Mapped[str] = mapped_column(String(10), nullable=False)
    recorded_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asset: Mapped["MaintenanceAsset"] = relationship()


class MaintenanceAssetComment(Base):
    """Note libere sull'asset nel tempo (§14): a differenza di `status_reason`,
    che è un campo unico sovrascritto a ogni cambio, qui ogni commento resta —
    append-only, nessuna modifica o cancellazione dalla UI.

    `status` e `status_reason` sono uno snapshot dello stato dell'asset al
    momento della nota (valorizzati dal server, non dall'utente): la nota
    resta quindi leggibile nel contesto in cui è stata scritta anche se lo
    stato dell'asset cambia in seguito."""

    __tablename__ = "maintenance_asset_comments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_assets.id"), nullable=False, index=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    # create_type=False: il tipo Postgres "maintenance_asset_status" è già
    # creato dalla colonna omonima di MaintenanceAsset. Senza questo flag,
    # con più worker uvicorn la rete di sicurezza create_all() può eseguire
    # in parallelo "esiste già?" + CREATE TYPE su entrambi i processi appena
    # questa tabella (nuova) viene creata, con DuplicateObject in corsa.
    status: Mapped[MaintenanceAssetStatus] = mapped_column(
        Enum(MaintenanceAssetStatus, name="maintenance_asset_status", create_type=False),
        nullable=False,
    )
    status_reason: Mapped[str | None] = mapped_column(String(255))
    created_by: Mapped[str | None] = mapped_column(String(120))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    asset: Mapped["MaintenanceAsset"] = relationship()


class MaintenanceAssetImage(TimestampMixin, Base):
    """Immagine anagrafica salvata su SMB, distinta dai documenti (§5/§11).

    `slot_key` identifica l'unico slot sostituibile per foto principale e
    campo tecnico; per la galleria coincide con l'id e consente più immagini.
    """

    __tablename__ = "maintenance_asset_images"
    __table_args__ = (
        UniqueConstraint("asset_id", "image_kind", "slot_key", name="uq_maintenance_asset_image_slot"),
        CheckConstraint(
            "image_kind IN ('main', 'technical', 'gallery')",
            name="ck_maintenance_asset_image_kind",
        ),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_assets.id"), nullable=False, index=True)
    image_kind: Mapped[str] = mapped_column(String(20), nullable=False)
    slot_key: Mapped[str] = mapped_column(String(80), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    file_path: Mapped[str] = mapped_column(String(400), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(120))

    asset: Mapped["MaintenanceAsset"] = relationship()


class MaintenanceDocument(TimestampMixin, Base):
    """Documento su file server SMB (§11): qui restano solo i metadati e il
    percorso relativo dentro la condivisione — il contenuto vive fuori dal
    database (vedi app.services.smb_storage).

    Niente più versionamento (deciso il 2026-09-03): più documenti dello
    stesso doc_type possono restare "rilasciato" contemporaneamente, e lo
    stato si cambia solo a mano. Le colonne `version`/`supersedes_id` restano
    fisicamente nel DB (nessuna migrazione distruttiva) ma non sono più
    mappate né lette/scritte da questo modello.
    """

    __tablename__ = "maintenance_documents"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_assets.id"), nullable=False, index=True)
    doc_type: Mapped[str] = mapped_column(String(60), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    status: Mapped[MaintenanceDocumentStatus] = mapped_column(
        Enum(MaintenanceDocumentStatus, name="maintenance_document_status"),
        default=MaintenanceDocumentStatus.rilasciato,
        server_default=MaintenanceDocumentStatus.rilasciato.value,
        nullable=False,
    )
    # Distingue le foto (sezione "Foto" dell'anagrafica) dai documenti veri e
    # propri (sezione "Documenti", §11 del documento requisiti): stessa
    # tabella e stesso versionamento, cambia solo dove compare in UI. Non
    # tocca i documenti esistenti (default False = documento, retrocompatibile).
    is_photo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)
    file_path: Mapped[str] = mapped_column(String(400), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    mime_type: Mapped[str] = mapped_column(String(120), nullable=False)
    size_bytes: Mapped[int] = mapped_column(Integer, nullable=False)
    uploaded_by: Mapped[str | None] = mapped_column(String(120))
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    deleted_by: Mapped[str | None] = mapped_column(String(120))
    deletion_reason: Mapped[str | None] = mapped_column(Text)


class MaintenanceDeadline(TimestampMixin, Base):
    __tablename__ = "maintenance_deadlines"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_assets.id"), nullable=False, index=True)
    deadline_type: Mapped[str] = mapped_column(String(120), nullable=False)
    due_date: Mapped[date] = mapped_column(Date, nullable=False)
    recurrence_basis: Mapped[MaintenanceDeadlineRecurrenceBasis | None] = mapped_column(
        Enum(MaintenanceDeadlineRecurrenceBasis, name="maintenance_deadline_recurrence_basis"),
    )
    recurrence_days: Mapped[int | None] = mapped_column(Integer)
    # Soglia a ore contaore, alternativa o complementare a due_date (§9: "per
    # alcuni [asset] legato anche alle ore di utilizzo"). Proiettata da
    # MaintenanceAssetCounter — non richiede una lettura ad ogni avvicinarsi
    # della soglia, solo letture periodiche da cui stimare il ritmo d'uso.
    # Ammessa solo se MaintenanceAssetType.tracks_usage_hours è True (vedi
    # services/maintenance_deadlines.create_deadline).
    due_hours: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    recurrence_hours: Mapped[int | None] = mapped_column(Integer)
    last_completed_hours: Mapped[Decimal | None] = mapped_column(Numeric(12, 2))
    # Soglie di preavviso in giorni, personalizzabili per scadenza (§9 del documento
    # requisiti: 30/15/7 di default, ma un'ispezione pluriennale ne richiede altre).
    notice_thresholds_days: Mapped[list] = mapped_column(
        JSONB_OR_JSON, default=lambda: [30, 15, 7], server_default="[30, 15, 7]", nullable=False
    )
    last_completed_at: Mapped[date | None] = mapped_column(Date)
    postponed_reason: Mapped[str | None] = mapped_column(Text)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    # Ultimo giorno in cui è stato inviato il promemoria email (§10): finché la
    # scadenza resta sopra soglia viene rimandato una volta al giorno, non a ogni
    # avvio dello scheduler — vedi services/maintenance_deadline_reminders.py.
    last_notice_email_date: Mapped[date | None] = mapped_column(Date)

    asset: Mapped["MaintenanceAsset"] = relationship()


class MaintenanceDeadlineAck(Base):
    """Stato di lettura per utente di una scadenza (§10): la campanella resta
    calcolata al volo come le altre categorie, questa tabella filtra solo cosa
    mostrare. Marcare come letta non tocca la scadenza sottostante — resta
    scaduta finché qualcuno non la completa o la posticipa."""

    __tablename__ = "maintenance_deadline_acks"
    __table_args__ = (UniqueConstraint("deadline_id", "user_id", name="uq_maintenance_deadline_ack"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    deadline_id: Mapped[str] = mapped_column(String(36), ForeignKey("maintenance_deadlines.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    acked_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now(), nullable=False)


class MaintenanceNotificationRule(TimestampMixin, Base):
    """Destinatari email per scadenza (§10 e §15): "ogni classe di asset ha una
    propria sezione di configurazione delle notifiche, con i gruppi di utenti
    da avvisare". `asset_class_id` e `site` nulli significano "qualunque" —
    una regola senza filtri copre tutto il parco. I destinatari sono
    LdapEmployee (stessa fonte email di services/email.py, non uno User: lo
    User del portale non porta l'indirizzo, sta sull'anagrafica LDAP)."""

    __tablename__ = "maintenance_notification_rules"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=lambda: str(uuid4()))
    asset_class_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("maintenance_asset_classes.id"))
    site: Mapped[str | None] = mapped_column(String(120))
    recipient_ldap_employee_ids: Mapped[list] = mapped_column(JSONB_OR_JSON, default=list, server_default="[]", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    asset_class: Mapped["MaintenanceAssetClass | None"] = relationship()

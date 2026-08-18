"""Configurazione delle integrazioni esterne, gestita dalla GUI e persistita a DB.

Le impostazioni vivono nella tabella `app_settings` e non nel `.env`: un
amministratore le cambia a caldo dalla pagina Configurazione › Integrazioni,
senza riavviare il backend, e il client secret è cifrato a riposo (vedi
`app.services.crypto`).

Regola non negoziabile: `office365.enabled` è l'interruttore generale. A OFF
nessuna funzionalità contatta Microsoft 365 via Graph — nemmeno in lettura,
nemmeno per chiedere un token. Ogni valore nasce spento: un'integrazione si
accende solo per scelta esplicita di un amministratore.

Fuori perimetro per scelta: l'invio email passa dal relay Exchange Online
(`SMTP_HOST`) ma resta governato dalla sola configurazione SMTP. Legarlo a
questo interruttore spegnerebbe anche le notifiche di approvazione assenze, che
devono continuare a partire a integrazione Graph disattivata.
"""

import logging
from dataclasses import dataclass, replace

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import AppSetting
from app.services.crypto import decrypt_secret, encrypt_secret

logger = logging.getLogger(__name__)

# Interruttore generale dell'integrazione Microsoft 365.
OFFICE365_ENABLED = "integrations.office365.enabled"
# Sotto-funzione: risposta automatica (fuori sede) su Outlook per le ferie.
OFFICE365_OOF_ENABLED = "integrations.office365.oof_enabled"
OFFICE365_TENANT_ID = "integrations.office365.tenant_id"
OFFICE365_CLIENT_ID = "integrations.office365.client_id"
OFFICE365_CLIENT_SECRET = "integrations.office365.client_secret"
OFFICE365_OOF_USE_MANAGER = "integrations.office365.oof_use_manager"
OFFICE365_OOF_FALLBACK_CONTACT = "integrations.office365.oof_fallback_contact"

SECRET_KEYS = frozenset({OFFICE365_CLIENT_SECRET})


@dataclass(frozen=True)
class Office365Config:
    """Fotografia coerente della configurazione, letta una volta sola.

    Tutti i default sono spenti/vuoti: se la tabella è vuota — installazione
    nuova, riga cancellata, errore di lettura — l'integrazione risulta
    disattivata, mai attiva per omissione.
    """

    enabled: bool = False
    oof_enabled: bool = False
    tenant_id: str = ""
    client_id: str = ""
    client_secret: str = ""
    oof_use_manager: bool = False
    oof_fallback_contact: str = ""

    @property
    def credentials_complete(self) -> bool:
        return bool(self.tenant_id and self.client_id and self.client_secret)

    @property
    def oof_active(self) -> bool:
        """La risposta automatica opera solo con interruttore generale acceso,
        sotto-funzione accesa e credenziali complete: le tre condizioni insieme."""
        return self.enabled and self.oof_enabled and self.credentials_complete


def _parse_bool(value: str | None) -> bool:
    return (value or "").strip().lower() in ("1", "true", "yes", "on")


def _format_bool(value: bool) -> str:
    return "true" if value else "false"


def _read_all(db: Session) -> dict[str, str | None]:
    rows = db.scalars(select(AppSetting).where(AppSetting.key.startswith("integrations.office365."))).all()
    return {row.key: row.value for row in rows}


def get_office365_config(db: Session) -> Office365Config:
    raw = _read_all(db)
    return Office365Config(
        enabled=_parse_bool(raw.get(OFFICE365_ENABLED)),
        oof_enabled=_parse_bool(raw.get(OFFICE365_OOF_ENABLED)),
        tenant_id=(raw.get(OFFICE365_TENANT_ID) or "").strip(),
        client_id=(raw.get(OFFICE365_CLIENT_ID) or "").strip(),
        client_secret=decrypt_secret(raw.get(OFFICE365_CLIENT_SECRET)) or "",
        oof_use_manager=_parse_bool(raw.get(OFFICE365_OOF_USE_MANAGER)),
        oof_fallback_contact=(raw.get(OFFICE365_OOF_FALLBACK_CONTACT) or "").strip(),
    )


def office365_enabled(db: Session) -> bool:
    """Interruttore generale, da interrogare prima di qualunque uso di Graph."""
    row = db.get(AppSetting, OFFICE365_ENABLED)
    return _parse_bool(row.value if row else None)


def _write(db: Session, key: str, value: str | None, actor: str | None) -> None:
    stored = encrypt_secret(value) if (key in SECRET_KEYS and value) else value
    row = db.get(AppSetting, key)
    if row is None:
        db.add(AppSetting(key=key, value=stored, updated_by=actor))
    else:
        row.value = stored
        row.updated_by = actor


def save_office365_config(
    db: Session,
    *,
    enabled: bool,
    oof_enabled: bool,
    tenant_id: str,
    client_id: str,
    client_secret: str | None,
    oof_use_manager: bool,
    oof_fallback_contact: str,
    actor: str | None = None,
) -> Office365Config:
    """Salva la configurazione. `client_secret` a None lascia invariato quello
    esistente (la GUI non lo rilegge mai, quindi non può rispedirlo); a stringa
    vuota lo cancella."""
    current = get_office365_config(db)

    _write(db, OFFICE365_ENABLED, _format_bool(enabled), actor)
    _write(db, OFFICE365_OOF_ENABLED, _format_bool(oof_enabled), actor)
    _write(db, OFFICE365_TENANT_ID, tenant_id.strip(), actor)
    _write(db, OFFICE365_CLIENT_ID, client_id.strip(), actor)
    _write(db, OFFICE365_OOF_USE_MANAGER, _format_bool(oof_use_manager), actor)
    _write(db, OFFICE365_OOF_FALLBACK_CONTACT, oof_fallback_contact.strip(), actor)

    if client_secret is None:
        new_secret = current.client_secret
    else:
        new_secret = client_secret.strip()
        _write(db, OFFICE365_CLIENT_SECRET, new_secret or None, actor)

    return replace(
        current,
        enabled=enabled,
        oof_enabled=oof_enabled,
        tenant_id=tenant_id.strip(),
        client_id=client_id.strip(),
        client_secret=new_secret,
        oof_use_manager=oof_use_manager,
        oof_fallback_contact=oof_fallback_contact.strip(),
    )

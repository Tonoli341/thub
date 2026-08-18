"""Risposta automatica (Fuori sede / Out of Office) su Outlook per le ferie.

Quando una richiesta di FERIE viene approvata (o modificata/cancellata), si
sincronizza la risposta automatica programmata della casella del dipendente via
Microsoft Graph (`mailboxSettings.automaticRepliesSetting`, status=scheduled).

Punti chiave:
- Tutto è gated dietro la configurazione salvata a database e amministrata da
  Configurazione › Integrazioni. L'interruttore generale `enabled` viene
  verificato PRIMA di qualsiasi altra cosa: a OFF non parte nulla, nemmeno il
  thread, nemmeno la richiesta del token.
- Exchange gestisce UNA sola finestra OOO programmata per casella, quindi la
  logica NON imposta "la singola ferie" ma RICALCOLA lo stato desiderato dalle
  ferie approvate ancora attive/future del dipendente (la più imminente vince).
- L'esecuzione è in un thread daemon con sessione DB propria: non blocca né fa
  fallire la request che l'ha innescata.
"""

import logging
import threading
import time
from datetime import date, datetime

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import SessionLocal
from app.enums import JustificationApprovalStatus, JustificationType
from app.models import Employee, Justification
from app.services.integrations import Office365Config, get_office365_config

logger = logging.getLogger(__name__)

GRAPH_BASE = "https://graph.microsoft.com/v1.0"
REQUEST_TIMEOUT = 30.0

# Il token è per applicazione, non per utente: si può riusare finché valgono le
# stesse credenziali. La chiave include tenant e client id così un cambio di
# configurazione dalla GUI non riusa mai il token dell'app precedente.
_token_cache: dict[str, tuple[str, float]] = {}
_token_lock = threading.Lock()


def _get_access_token(config: Office365Config) -> str:
    cache_key = f"{config.tenant_id}:{config.client_id}"
    with _token_lock:
        cached = _token_cache.get(cache_key)
        if cached and cached[1] > time.time() + 60:
            return cached[0]

    response = httpx.post(
        f"https://login.microsoftonline.com/{config.tenant_id}/oauth2/v2.0/token",
        data={
            "grant_type": "client_credentials",
            "client_id": config.client_id,
            "client_secret": config.client_secret,
            "scope": "https://graph.microsoft.com/.default",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()
    payload = response.json()
    token = payload.get("access_token")
    if not token:
        raise RuntimeError("Risposta Graph priva di access_token.")
    with _token_lock:
        _token_cache[cache_key] = (str(token), time.time() + float(payload.get("expires_in", 3600)))
    return str(token)


def invalidate_token_cache() -> None:
    """Da chiamare quando la configurazione cambia: le credenziali vecchie non
    devono sopravvivere in cache a uno spegnimento o a una rotazione."""
    with _token_lock:
        _token_cache.clear()


def _format_it_date(value: date) -> str:
    return value.strftime("%d/%m/%Y")


def _graph_datetime(value: datetime) -> dict:
    # Graph richiede naive local time + il fuso in chiaro; usiamo l'ora italiana.
    return {"dateTime": value.strftime("%Y-%m-%dT%H:%M:%S"), "timeZone": "W. Europe Standard Time"}


def _build_messages(employee_name: str, start: date, end: date, contact: str | None) -> tuple[str, str]:
    period = f"dal {_format_it_date(start)} al {_format_it_date(end)}"
    contact_line = (
        f" Per urgenze può contattare {contact}."
        if contact else ""
    )
    internal = (
        f"<p>Buongiorno,</p>"
        f"<p>sono assente {period} e risponderò al rientro.{contact_line}</p>"
        f"<p>Cordiali saluti,<br>{employee_name}</p>"
    )
    # Messaggio esterno più sobrio, senza il nome del contatto interno se non serve.
    external = (
        f"<p>Buongiorno,</p>"
        f"<p>sono assente {period} e risponderò al rientro.{contact_line}</p>"
        f"<p>Cordiali saluti,<br>{employee_name}</p>"
    )
    return internal, external


def _resolve_contact(db: Session, employee: Employee, config: Office365Config) -> str | None:
    if config.oof_use_manager and employee.manager is not None:
        manager = employee.manager
        contact_email = _mailbox_for(db, manager.id)
        if contact_email:
            return f"{manager.full_name} ({contact_email})"
        return manager.full_name
    return config.oof_fallback_contact or None


def _mailbox_for(db: Session, employee_id: str) -> str | None:
    # Import locale per evitare cicli: la risoluzione email vive nel servizio email.
    from app.services.email import get_employee_email

    return get_employee_email(db, employee_id)


def _active_ferie_window(db: Session, employee_id: str) -> Justification | None:
    """La ferie approvata più imminente ancora valida (fine >= oggi).
    È quella che deve occupare l'unica finestra OOO della casella."""
    today = date.today()
    statement = (
        select(Justification)
        .where(
            Justification.employee_id == employee_id,
            Justification.justification_type == JustificationType.ferie,
            Justification.approval_status == JustificationApprovalStatus.approved,
            Justification.end_date >= today,
        )
        .order_by(Justification.start_date.asc())
    )
    return db.scalars(statement).first()


def _patch_mailbox_settings(config: Office365Config, mailbox: str, automatic_replies: dict) -> None:
    token = _get_access_token(config)
    response = httpx.patch(
        f"{GRAPH_BASE}/users/{mailbox}/mailboxSettings",
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
        json={"automaticRepliesSetting": automatic_replies},
        timeout=REQUEST_TIMEOUT,
    )
    response.raise_for_status()


def _sync_sync(employee_id: str, config: Office365Config) -> None:
    """Corpo sincrono eseguito nel thread: apre una sessione propria."""
    try:
        with SessionLocal() as db:
            employee = db.get(Employee, employee_id)
            if employee is None:
                return
            mailbox = _mailbox_for(db, employee_id)
            if not mailbox:
                logger.info("OOF: nessuna email per il dipendente %s, salto.", employee_id)
                return

            ferie = _active_ferie_window(db, employee_id)
            if ferie is None:
                # Nessuna ferie attiva/futura approvata: disattiva l'OOO programmato.
                _patch_mailbox_settings(config, mailbox, {"status": "disabled"})
                logger.info("OOF disattivato per %s (%s).", employee.full_name, mailbox)
                return

            contact = _resolve_contact(db, employee, config)
            internal, external = _build_messages(employee.full_name, ferie.start_date, ferie.end_date, contact)
            start_dt = datetime.combine(ferie.start_date, ferie.start_time)
            end_dt = datetime.combine(ferie.end_date, ferie.end_time)
            _patch_mailbox_settings(config, mailbox, {
                "status": "scheduled",
                "scheduledStartDateTime": _graph_datetime(start_dt),
                "scheduledEndDateTime": _graph_datetime(end_dt),
                "externalAudience": "all",
                "internalReplyMessage": internal,
                "externalReplyMessage": external,
            })
            logger.info(
                "OOF programmato per %s (%s) dal %s al %s.",
                employee.full_name, mailbox, ferie.start_date, ferie.end_date,
            )
    except httpx.HTTPStatusError as exc:
        logger.warning("OOF Graph HTTP %s per %s: %s", exc.response.status_code, employee_id, exc.response.text[:300])
    except Exception:  # noqa: BLE001 - non deve mai propagare nella request
        logger.exception("OOF: sincronizzazione fallita per %s", employee_id)


def sync_employee_oof(employee_id: str) -> None:
    """Ricalcola e applica in background la risposta automatica del dipendente.

    Il controllo dell'interruttore è sincrono e avviene qui, prima di far
    partire il thread: a integrazione spenta questa funzione è un no-op puro,
    nessun thread e nessun contatto con Microsoft 365.
    """
    try:
        with SessionLocal() as db:
            config = get_office365_config(db)
    except Exception:  # noqa: BLE001 - una lettura fallita non deve rompere la request
        logger.exception("OOF: lettura della configurazione fallita, sincronizzazione saltata.")
        return

    if not config.oof_active:
        return
    threading.Thread(target=_sync_sync, args=(employee_id, config), daemon=True).start()

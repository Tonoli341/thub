"""Accesso alla cartella documenti del modulo Manutenzioni su file server SMB.

Il backend parla SMB direttamente (libreria smbprotocol/smbclient): nessun
mount a livello di sistema operativo, nessun volume Docker, la condivisione è
raggiunta via rete esattamente come TMS e stocktonoli in app/config.py.

Le credenziali vivono in `.env` (APP_SMB_*) per scelta esplicita dell'utente,
in deroga alla convenzione del repo che cifra a database i segreti delle
integrazioni (AGENTS.md §4): qui non c'è una GUI di amministrazione, è
configurazione d'ambiente del servizio documentale.
"""

from __future__ import annotations

import logging
import ntpath

import smbclient

from app.config import settings
from app.services.errors import DomainError

logger = logging.getLogger(__name__)

_session_registered = False


def is_configured() -> bool:
    return bool(settings.app_smb_host and settings.app_smb_share)


def _ensure_session() -> None:
    global _session_registered
    if _session_registered:
        return
    if not is_configured():
        raise DomainError("Cartella documenti manutenzioni non configurata (APP_SMB_* mancanti).")
    # smbclient.register_session non accetta un parametro domain separato: il
    # dominio NTLM va nello username stesso ("DOMINIO\\utente"), è
    # smbprotocol.authentication a scomporlo.
    username = settings.app_smb_username
    if settings.app_smb_domain:
        username = f"{settings.app_smb_domain}\\{username}"
    smbclient.register_session(
        settings.app_smb_host,
        username=username,
        password=settings.app_smb_password,
        port=settings.app_smb_port,
    )
    _session_registered = True


def _full_path(relative_path: str) -> str:
    base = ntpath.normpath(ntpath.join(settings.app_smb_base_path, relative_path))
    return f"\\\\{settings.app_smb_host}\\{settings.app_smb_share}\\{base}"


def write_document(relative_path: str, content: bytes) -> None:
    _ensure_session()
    full_path = _full_path(relative_path)
    directory = ntpath.dirname(full_path)
    try:
        smbclient.makedirs(directory, exist_ok=True)
        with smbclient.open_file(full_path, mode="wb") as handle:
            handle.write(content)
    except Exception as exc:
        logger.exception("Scrittura documento manutenzioni fallita: %s", relative_path)
        raise DomainError("Impossibile salvare il documento: cartella condivisa non raggiungibile.") from exc


def read_document(relative_path: str) -> bytes:
    _ensure_session()
    full_path = _full_path(relative_path)
    try:
        with smbclient.open_file(full_path, mode="rb") as handle:
            return handle.read()
    except Exception as exc:
        logger.exception("Lettura documento manutenzioni fallita: %s", relative_path)
        raise DomainError("Impossibile leggere il documento: cartella condivisa non raggiungibile.") from exc


def delete_document(relative_path: str) -> None:
    _ensure_session()
    full_path = _full_path(relative_path)
    try:
        smbclient.remove(full_path)
    except Exception as exc:
        logger.exception("Eliminazione documento manutenzioni fallita: %s", relative_path)
        raise DomainError("Impossibile eliminare il documento sulla cartella condivisa.") from exc


def write_image(relative_path: str, content: bytes) -> None:
    _ensure_session()
    full_path = _full_path(relative_path)
    directory = ntpath.dirname(full_path)
    try:
        smbclient.makedirs(directory, exist_ok=True)
        with smbclient.open_file(full_path, mode="wb") as handle:
            handle.write(content)
    except Exception as exc:
        logger.exception("Scrittura immagine asset fallita: %s", relative_path)
        raise DomainError("Impossibile salvare l'immagine: cartella condivisa non raggiungibile.") from exc


def read_image(relative_path: str) -> bytes:
    _ensure_session()
    full_path = _full_path(relative_path)
    try:
        with smbclient.open_file(full_path, mode="rb") as handle:
            return handle.read()
    except Exception as exc:
        logger.exception("Lettura immagine asset fallita: %s", relative_path)
        raise DomainError("Impossibile leggere l'immagine: cartella condivisa non raggiungibile.") from exc


def delete_image(relative_path: str) -> None:
    _ensure_session()
    full_path = _full_path(relative_path)
    try:
        smbclient.remove(full_path)
    except Exception as exc:
        logger.exception("Eliminazione immagine asset fallita: %s", relative_path)
        raise DomainError("Impossibile eliminare l'immagine dalla cartella condivisa.") from exc

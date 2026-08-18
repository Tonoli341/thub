"""Cifratura dei segreti applicativi conservati a database.

I segreti delle integrazioni (per esempio il client secret dell'app Entra) non
devono stare in chiaro da nessuna parte: né nel `.env`, né in una colonna del
database, né nelle risposte dell'API. Questo modulo è l'unico punto in cui
vengono cifrati e decifrati, con Fernet (AES-128-CBC + HMAC) e una chiave
derivata da `settings.secrets_encryption_key`.

Resta un segreto d'ambiente — la chiave — ma il problema si sposta dal dato al
keyring, che è esattamente lo scopo: un dump del database, un backup finito nel
posto sbagliato o una query di troppo non bastano più a leggere le credenziali.
"""

import base64
import hashlib
import logging

from app.config import settings

logger = logging.getLogger(__name__)

# La cifratura serve a una funzione accessoria: un pacchetto mancante non deve
# impedire l'avvio dell'API — altrimenti un'immagine non ricostruita si porta
# dietro anche il login. Senza `cryptography` l'app parte e funziona, ma i
# segreti delle integrazioni non si possono salvare né rileggere.
try:
    from cryptography.fernet import Fernet, InvalidToken

    _ENCRYPTION_AVAILABLE = True
except ModuleNotFoundError:  # pragma: no cover - dipende dall'immagine
    Fernet = None

    class InvalidToken(Exception):
        pass

    _ENCRYPTION_AVAILABLE = False
    logger.warning(
        "Pacchetto 'cryptography' non installato: i segreti delle integrazioni non sono "
        "salvabili. Ricostruire l'immagine del backend (docker compose build backend)."
    )

# Prefisso di versione: permette di riconoscere i valori cifrati e, un domani,
# di introdurre un secondo schema senza ambiguità su cosa c'è già salvato.
ENCRYPTED_PREFIX = "enc:v1:"


def encryption_available() -> bool:
    """False quando manca `cryptography`: chi salva segreti deve fermarsi prima
    di scrivere, mai ripiegare sul testo in chiaro."""
    return _ENCRYPTION_AVAILABLE


def _fernet() -> "Fernet":
    # La chiave dedicata è quella giusta; il fallback sul segreto JWT evita che
    # un ambiente non ancora aggiornato salvi credenziali in chiaro.
    key_material = settings.secrets_encryption_key or settings.jwt_secret_key
    digest = hashlib.sha256(key_material.encode("utf-8")).digest()
    return Fernet(base64.urlsafe_b64encode(digest))


def encrypt_secret(value: str) -> str:
    if not _ENCRYPTION_AVAILABLE:
        raise RuntimeError(
            "Cifratura non disponibile: manca il pacchetto 'cryptography'. "
            "Ricostruire l'immagine del backend prima di salvare segreti."
        )
    return ENCRYPTED_PREFIX + _fernet().encrypt(value.encode("utf-8")).decode("ascii")


def decrypt_secret(stored: str | None) -> str | None:
    """Restituisce il segreto in chiaro, o None se manca o non è decifrabile."""
    if not stored:
        return None
    if stored.startswith(ENCRYPTED_PREFIX) and not _ENCRYPTION_AVAILABLE:
        logger.error("Segreto cifrato non leggibile: manca il pacchetto 'cryptography'.")
        return None
    if not stored.startswith(ENCRYPTED_PREFIX):
        # Valore scritto prima dell'introduzione della cifratura: si legge, ma
        # va riscritto dalla GUI perché torni protetto.
        logger.warning("Segreto trovato in chiaro a database: riscriverlo dalla configurazione.")
        return stored
    try:
        token = stored[len(ENCRYPTED_PREFIX):].encode("ascii")
        return _fernet().decrypt(token).decode("utf-8")
    except InvalidToken:
        # Tipicamente: SECRETS_ENCRYPTION_KEY cambiata dopo il salvataggio.
        logger.error("Segreto non decifrabile: la chiave di cifratura non corrisponde. Reinserirlo dalla GUI.")
        return None


def secret_hint(value: str | None) -> str:
    """Coda del segreto, per far riconoscere all'amministratore quale credenziale
    è salvata senza mai rivelarla per intero."""
    if not value:
        return ""
    return f"…{value[-4:]}" if len(value) > 4 else "…"

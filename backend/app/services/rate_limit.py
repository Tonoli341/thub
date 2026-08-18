"""Rate limiting in-memory per i tentativi di login.

Finestra scorrevole per chiave (ip + username): oltre la soglia l'endpoint
risponde 429 senza nemmeno interrogare LDAP/DB, così si mitigano brute force
e lockout indotti sugli account di dominio. Lo stato è per-processo: con più
worker il limite effettivo è (soglia × worker), comunque sufficiente come
protezione di base.
"""

from __future__ import annotations

import threading
import time

from fastapi import HTTPException, Request, status

_MAX_FAILURES = 5
_WINDOW_SECONDS = 300

_failures: dict[str, list[float]] = {}
_lock = threading.Lock()


def _normalize(username: str) -> str:
    return username.strip().lower()


def _client_key(request: Request, username: str) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    ip = forwarded.split(",")[0].strip() if forwarded else (request.client.host if request.client else "unknown")
    return f"{ip}|{_normalize(username)}"


def check_login_allowed(request: Request, username: str) -> None:
    key = _client_key(request, username)
    now = time.monotonic()
    with _lock:
        attempts = [t for t in _failures.get(key, []) if now - t < _WINDOW_SECONDS]
        _failures[key] = attempts
        if len(attempts) >= _MAX_FAILURES:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Troppi tentativi di accesso falliti. Riprova tra qualche minuto.",
            )


def record_login_failure(request: Request, username: str) -> None:
    key = _client_key(request, username)
    now = time.monotonic()
    with _lock:
        attempts = [t for t in _failures.get(key, []) if now - t < _WINDOW_SECONDS]
        attempts.append(now)
        _failures[key] = attempts


def reset_login_failures(request: Request, username: str) -> None:
    key = _client_key(request, username)
    with _lock:
        _failures.pop(key, None)


def is_username_locked(username: str) -> bool:
    """True se l'utente è bloccato da almeno un IP (sblocco manuale utile)."""
    suffix = f"|{_normalize(username)}"
    now = time.monotonic()
    with _lock:
        for key, attempts in _failures.items():
            if not key.endswith(suffix):
                continue
            if len([t for t in attempts if now - t < _WINDOW_SECONDS]) >= _MAX_FAILURES:
                return True
    return False


def reset_failures_for_username(username: str) -> int:
    """Azzera i fallimenti dell'utente da qualsiasi IP; ritorna le chiavi rimosse."""
    suffix = f"|{_normalize(username)}"
    with _lock:
        keys = [key for key in _failures if key.endswith(suffix)]
        for key in keys:
            _failures.pop(key, None)
    return len(keys)

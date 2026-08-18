import logging
import os
import shutil
import time
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import require_admin
from app.config import settings
from app.db import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["system"], dependencies=[Depends(require_admin)])

_process_started_at = datetime.now(timezone.utc)

# Cache in-process: le misure non cambiano in modo utile nell'arco di pochi
# secondi e il campionamento CPU blocca un thread per 0.3s, quindi richieste
# ravvicinate (più tab admin, refresh compulsivi) costano quanto una sola.
_CACHE_TTL_SECONDS = 5.0
_cached_payload: dict | None = None
_cached_at: float = 0.0


def _host_memory() -> dict:
    """Memoria dell'host da /proc/meminfo (in un container senza limiti di
    memoria /proc riflette l'host, che è ciò che interessa qui)."""
    values: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, _, rest = line.partition(":")
            if key in ("MemTotal", "MemAvailable"):
                values[key] = int(rest.strip().split()[0]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    total = values.get("MemTotal")
    available = values.get("MemAvailable")
    used = total - available if total is not None and available is not None else None
    return {
        "total_bytes": total,
        "used_bytes": used,
        "available_bytes": available,
        "percent": round(used / total * 100, 1) if used is not None and total else None,
        "container": _cgroup_memory(),
    }


def _cgroup_memory() -> dict | None:
    """Limite e uso di memoria del container dai cgroup v2, presente solo se
    al container è stato assegnato un limite esplicito."""
    try:
        max_raw = Path("/sys/fs/cgroup/memory.max").read_text().strip()
        if max_raw == "max":
            return None
        current = int(Path("/sys/fs/cgroup/memory.current").read_text().strip())
        limit = int(max_raw)
        return {
            "limit_bytes": limit,
            "used_bytes": current,
            "percent": round(current / limit * 100, 1) if limit else None,
        }
    except (OSError, ValueError):
        return None


def _read_cpu_ticks() -> tuple[int, int] | None:
    """(tick occupati, tick totali) dalla riga aggregata di /proc/stat."""
    try:
        fields = Path("/proc/stat").read_text().splitlines()[0].split()[1:]
        ticks = [int(v) for v in fields]
        idle = ticks[3] + (ticks[4] if len(ticks) > 4 else 0)  # idle + iowait
        total = sum(ticks)
        return total - idle, total
    except (OSError, ValueError, IndexError):
        return None


def _cpu_percent(sample_seconds: float = 0.3) -> float | None:
    first = _read_cpu_ticks()
    if first is None:
        return None
    time.sleep(sample_seconds)
    second = _read_cpu_ticks()
    if second is None:
        return None
    busy = second[0] - first[0]
    total = second[1] - first[1]
    return round(busy / total * 100, 1) if total > 0 else None


def _host_uptime_seconds() -> int | None:
    try:
        return int(float(Path("/proc/uptime").read_text().split()[0]))
    except (OSError, ValueError, IndexError):
        return None


def _database_status(db: Session) -> dict:
    try:
        started = time.perf_counter()
        db.execute(text("SELECT 1"))
        latency_ms = round((time.perf_counter() - started) * 1000, 1)
        size_bytes = db.scalar(text("SELECT pg_database_size(current_database())"))
        connections = db.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname = current_database()"))
        return {
            "status": "ok",
            "latency_ms": latency_ms,
            "size_bytes": int(size_bytes) if size_bytes is not None else None,
            "connections": int(connections) if connections is not None else None,
        }
    except Exception:  # noqa: BLE001 - lo stato del DB va riportato, non propagato
        # Il messaggio dell'eccezione può contenere host e credenziali della
        # connection string: nel log completo, al client solo un testo generico.
        logger.exception("Controllo stato database fallito")
        return {"status": "error", "detail": "Database non raggiungibile."}


@router.get("/status")
def system_status(db: Session = Depends(get_db)) -> dict:
    """Stato di salute di host e applicazione, misurato solo su richiesta
    (nessun lavoro periodico in background). Il backend gira in un container
    senza limiti di risorse, quindi disco, memoria e CPU letti da /proc
    riflettono l'host su cui gira Docker."""
    global _cached_payload, _cached_at
    if _cached_payload is not None and time.monotonic() - _cached_at < _CACHE_TTL_SECONDS:
        return _cached_payload

    now = datetime.now(timezone.utc)

    disk = shutil.disk_usage("/")
    load_avg = os.getloadavg()
    host_uptime = _host_uptime_seconds()

    payload = {
        "checked_at": now.isoformat(),
        "app": {
            "name": settings.app_name,
            "env": settings.app_env,
            "backend_uptime_seconds": int((now - _process_started_at).total_seconds()),
            "host_uptime_seconds": host_uptime,
        },
        "disk": {
            "total_bytes": disk.total,
            "used_bytes": disk.used,
            "free_bytes": disk.free,
            "percent": round(disk.used / disk.total * 100, 1) if disk.total else None,
        },
        "memory": _host_memory(),
        "cpu": {
            "percent": _cpu_percent(),
            "cores": os.cpu_count() or 1,
            "load_avg": [round(v, 2) for v in load_avg],
        },
        "database": _database_status(db),
    }
    _cached_payload = payload
    _cached_at = time.monotonic()
    return payload

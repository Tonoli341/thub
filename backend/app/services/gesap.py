"""Accesso in sola lettura alle prenotazioni del servizio Gesap/ToolTo."""

import json
import urllib.request
from datetime import date

from app.config import settings


def fetch_prenotazioni(work_date: date) -> dict:
    url = f"{settings.gesap_base_url.rstrip('/')}/prenotazioni_domani_senza_login.php?data={work_date.isoformat()}"
    with urllib.request.urlopen(url, timeout=10) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
        raise ValueError("Risposta Gesap non valida")
    return payload

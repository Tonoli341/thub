"""Proxy autenticato verso il servizio Gesap interno.

Prima il frontend chiamava direttamente il PHP "senza login" tramite una
location nginx aperta (/gesap-proxy/): chiunque raggiungesse la porta 8088
poteva interrogarlo. Ora la chiamata passa da qui e richiede un token valido.
"""

import json
import urllib.request
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.config import settings
from app.models import User
from app.services.security import get_current_user

router = APIRouter(prefix="/gesap", tags=["gesap"])


@router.get("/prenotazioni")
def list_prenotazioni(
    data: date = Query(...),
    _: User = Depends(get_current_user),
):
    url = f"{settings.gesap_base_url.rstrip('/')}/prenotazioni_domani_senza_login.php?data={data.isoformat()}"
    try:
        with urllib.request.urlopen(url, timeout=10) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Servizio Gesap non raggiungibile.",
        ) from exc

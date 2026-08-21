from datetime import date, datetime
from zoneinfo import ZoneInfo

LOCAL_TZ = ZoneInfo("Europe/Rome")


def today_local() -> date:
    """La data "di oggi" per l'azienda (Europe/Rome), indipendente dal fuso del container."""
    return datetime.now(LOCAL_TZ).date()


def now_local() -> datetime:
    """Data e ora aziendale, inclusi gli effetti dell'ora legale."""
    return datetime.now(LOCAL_TZ)

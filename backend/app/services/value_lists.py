"""Esecuzione delle sorgenti value-list su MSSQL.

Stessa connessione di services/stocktonoli.py. I parametri sono sempre
*bindati* da pytds (placeholder %s), mai interpolati nella SQL.
"""
import pytds

from app.config import settings
from app.services.value_list_sources import ValueListSource


def _connect():
    if not settings.stocktonoli_username or not settings.stocktonoli_password:
        raise RuntimeError(
            "Stocktonoli credentials missing. Configure STOCKTONOLI_USERNAME and STOCKTONOLI_PASSWORD in .env."
        )
    return pytds.connect(
        server=settings.stocktonoli_host,
        database=settings.stocktonoli_database,
        user=settings.stocktonoli_username,
        password=settings.stocktonoli_password,
        port=settings.stocktonoli_port,
        timeout=10,
        login_timeout=10,
    )


def _query(source: ValueListSource) -> str:
    query = getattr(settings, source.query_setting, "")
    if not query:
        raise RuntimeError(
            f"Query mancante per la sorgente '{source.key}': configurare {source.query_setting.upper()} in .env."
        )
    return query


def fetch_value_list_columns(source: ValueListSource) -> list[str]:
    """Nomi delle colonne della sorgente.

    Esegue la query con parametri vuoti: non torna righe, ma cursor.description
    è comunque popolato. Serve alla Libreria Campi per far scegliere la colonna
    chiave e la visibilità, senza mai esporre la SQL al client.
    """
    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(_query(source), tuple("" for _ in source.params))
            cursor.fetchall()
            return [col[0] for col in cursor.description or []]


def fetch_value_list(source: ValueListSource, params: dict[str, str]) -> list[dict]:
    """Righe della sorgente, come dict {nome_colonna: valore}."""
    values = tuple(params[name] for name in source.params)
    with _connect() as connection:
        with connection.cursor() as cursor:
            cursor.execute(_query(source), values)
            columns = [col[0] for col in cursor.description or []]
            rows = cursor.fetchall()

    return [
        {col: ("" if value is None else str(value).strip()) for col, value in zip(columns, row)}
        for row in rows
    ]

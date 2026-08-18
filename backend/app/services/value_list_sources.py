"""Registro delle sorgenti value-list MSSQL.

Insieme *chiuso* di query definite dall'admin: la SQL non transita mai dal
client. La Libreria Campi salva soltanto la `key` di una sorgente di questo
registro, e i parametri sono risolti server-side dall'incrocio (vedi
api/field_definitions.py). Aggiungere una sorgente = una voce qui + il campo
query corrispondente su Settings.
"""
from dataclasses import dataclass


@dataclass(frozen=True)
class ValueListSource:
    key: str
    label: str
    # Nome dell'attributo su Settings che contiene la SQL (parametrizzata con %s).
    query_setting: str
    # Parametri richiesti, nell'ordine in cui la query li binda.
    params: tuple[str, ...] = ()


VALUE_LIST_SOURCES: dict[str, ValueListSource] = {
    "liste_aperte": ValueListSource(
        key="liste_aperte",
        label="Liste aperte in uscita",
        query_setting="liste_aperte_query",
        params=("customer_supplier_code",),
    ),
}


def get_source(key: str) -> ValueListSource | None:
    return VALUE_LIST_SOURCES.get(key)

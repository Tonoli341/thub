from dataclasses import dataclass

import pytds

from app.config import settings


@dataclass
class StocktonoliCustomerSupplierRecord:
    code: str
    description: str


def fetch_customer_suppliers() -> list[StocktonoliCustomerSupplierRecord]:
    if not settings.stocktonoli_username or not settings.stocktonoli_password:
        raise RuntimeError(
            "Stocktonoli credentials missing. Configure STOCKTONOLI_USERNAME and STOCKTONOLI_PASSWORD in .env."
        )

    records: list[StocktonoliCustomerSupplierRecord] = []
    with pytds.connect(
        server=settings.stocktonoli_host,
        database=settings.stocktonoli_database,
        user=settings.stocktonoli_username,
        password=settings.stocktonoli_password,
        port=settings.stocktonoli_port,
        timeout=10,
        login_timeout=10,
    ) as connection:
        with connection.cursor() as cursor:
            cursor.execute(settings.stocktonoli_customer_supplier_query)
            rows = cursor.fetchall()

        for row in rows:
            if len(row) < 2:
                continue
            code = str(row[0] or "").strip()
            description = str(row[1] or "").strip()
            if not code and not description:
                continue
            records.append(
                StocktonoliCustomerSupplierRecord(
                    code=code,
                    description=description or code,
                )
            )

    return records

"""
Inserimento ferie estive 2026.
Eseguire con:
  sudo docker exec thub-backend-1 python3 /app/insert_ferie.py
oppure dry-run (solo stampa, nessun insert):
  sudo docker exec thub-backend-1 python3 /app/insert_ferie.py --dry-run
"""
import sys
from datetime import date, timedelta, time
from uuid import uuid4

DRY_RUN = "--dry-run" in sys.argv

YEAR = 2026

# ── dati ferie ────────────────────────────────────────────────────────────────
RAW = """
Pansa S. : ferie 25/06 al 26/06, 29/06
Giraudo M. : ferie 10/08 al 14/08, 17/08 al 21/08
Bodino D. : ferie 09/06, 22/06, 07/09 al 11/09, 14/09 al 18/09
Sasia S. : ferie 20/07 al 24/07, 27/07 al 31/07
Borza D. : ferie 01/06
Trezza P. : ferie 25/06 al 26/06, 29/06 al 03/07, 06/07 al 10/07, 13/07 al 17/07, 20/07 al 24/07
Trezza E. : ferie 17/07, 20/07 al 24/07, 27/07 al 31/07, 03/08 al 07/08, 10/08 al 14/08
Spagnolo M. : ferie 14/09 al 18/09
Romano S. : ferie 10/08 al 14/08, 17/08 al 21/08
Dervishi S. : ferie 29/06 al 03/07, 06/07 al 07/07
Bertero M. : ferie 27/07 al 31/07, 18/08, 28/08
Gerbaudo M. : ferie 07/09 al 11/09, 14/09 al 18/09
Osella M. : ferie 01/06, 02/07 al 03/07, 06/07 al 07/07
Rrotani G. : ferie 01/06, 03/06 al 05/06, 08/06 al 12/06
Paschetta D. : ferie 17/07, 17/08 al 21/08, 24/08 al 28/08, 05/10 al 09/10
Fonzo L. : ferie 01/06, 03/06 al 05/06
Allocco M. : ferie 01/06
Abello A. : ferie 20/07 al 24/07, 10/08 al 14/08
Busso M. : ferie 17/08 al 21/08
Ndoja K. : ferie 01/07 al 03/07, 06/07 al 10/07
Moretto Giorgio : ferie 21/08, 24/08 al 28/08, 31/08
Pupchenko I. : ferie 20/07 al 24/07
Napoli D. : ferie 06/07 al 10/07, 31/08 al 04/09
Cucchietti C. : ferie 29/06 al 03/07
Hyseni G. : ferie 19/06, 22/06 al 26/06
Damilano P. : ferie 25/06 al 26/06, 17/08 al 21/08
Pecile M. : ferie 31/08 al 04/09
Ballatore D. : ferie 13/07 al 17/07
Armando G. : ferie 10/08 al 14/08, 17/08 al 21/08
Bonardo A : ferie 13/07 al 17/07
Testa M. : ferie 15/06 al 19/06, 21/09 al 25/09
Lovera S. : ferie 03/08 al 07/08
Bernardinello F. : ferie 17/08 al 21/08, 24/08 al 28/08
Doria M. : ferie 10/08 al 14/08, 31/08 al 04/09
Dalmasso P. : ferie 22/06 al 26/06, 17/08 al 21/08, 24/08
Zucchetti M. : ferie 20/07 al 24/07, 10/08 al 14/08, 17/08 al 21/08
Gallo A. : ferie 15/06 al 17/06
Mattio G. : ferie 14/08, 17/08 al 18/08
Rivoira E. : ferie 17/08 al 21/08, 24/08 al 28/08
Porretti A. : ferie 10/08 al 14/08, 17/08 al 21/08
Miglietta P. : ferie 10/08 al 14/08, 17/08 al 21/08
Stefanin F. : ferie 10/08 al 14/08, 17/08 al 21/08
Giordano A. : ferie 10/08 al 14/08
Moretto G. : ferie 21/08, 24/08 al 28/08, 31/08
Boiero G. : ferie 13/07 al 17/07, 20/07 al 24/07
Cafasso R. : ferie 13/07 al 17/07, 20/07 al 21/07
Zavatteri G. : ferie 17/08 al 21/08, 24/08 al 28/08
Ejlli A. : ferie 15/06 al 19/06, 22/06 al 26/06
Spissu C. : ferie 06/07 al 10/07, 13/07 al 17/07
Paschetta G. : ferie 03/08 al 07/08, 10/08 al 14/08
Zedda A. : ferie 24/08 al 28/08, 31/08 al 04/09
""".strip()


# ── parsing date ──────────────────────────────────────────────────────────────
def parse_date(s: str, prev_month: int | None = None) -> date:
    s = s.strip()
    parts = s.split("/")
    day = int(parts[0])
    month = int(parts[1]) if len(parts) > 1 else prev_month
    return date(YEAR, month, day)


def parse_ranges(ferie_str: str) -> list[tuple[date, date]]:
    """Ritorna lista di (start_date, end_date) — anche singoli giorni (start==end)."""
    segments = [s.strip() for s in ferie_str.split(",")]
    ranges = []
    last_month = None
    for seg in segments:
        if " al " in seg:
            left, right = seg.split(" al ")
            d1 = parse_date(left.strip(), last_month)
            last_month = d1.month
            d2 = parse_date(right.strip(), last_month)
            last_month = d2.month
            ranges.append((d1, d2))
        else:
            d = parse_date(seg.strip(), last_month)
            last_month = d.month
            ranges.append((d, d))
    return ranges


def parse_raw() -> list[tuple[str, list[tuple[date, date]]]]:
    result = []
    for line in RAW.splitlines():
        line = line.strip()
        if not line:
            continue
        name_part, ferie_part = line.split(" : ferie ")
        name = name_part.strip()
        ranges = parse_ranges(ferie_part.strip())
        result.append((name, ranges))
    return result


# ── name matching ─────────────────────────────────────────────────────────────
def match_employee(name: str, employees: list) -> object | None:
    """
    Prova a matchare 'Cognome I.' o 'Cognome Nome' contro full_name nel DB.
    Il DB ha full_name in formato 'Nome Cognome'.
    """
    name = name.strip().rstrip(".")
    parts = name.split()

    candidates = []
    for emp in employees:
        fn: str = emp.full_name or ""
        fn_parts = fn.split()
        if not fn_parts:
            continue

        # Cognome è l'ultimo token di full_name (o secondo se formato è 'Nome Cognome')
        # Proviamo entrambi i formati: cerca il cognome della lista in qualsiasi token
        surname = parts[0].lower()
        first_initial = parts[1].lower().rstrip(".") if len(parts) > 1 else None

        fn_lower = fn.lower()
        fn_parts_lower = [p.lower() for p in fn_parts]

        if surname not in fn_parts_lower:
            continue

        if first_initial is None:
            candidates.append(emp)
            continue

        # se l'iniziale è una sola lettera, controlla che almeno un token inizi con essa
        if len(first_initial) == 1:
            if any(p.startswith(first_initial) and p != surname for p in fn_parts_lower):
                candidates.append(emp)
        else:
            # nome completo (es. "Moretto Giorgio")
            if first_initial in fn_parts_lower:
                candidates.append(emp)

    if len(candidates) == 1:
        return candidates[0]
    if len(candidates) > 1:
        # ambiguità: ritorna tutti per segnalarlo
        return candidates
    return None


# ── main ──────────────────────────────────────────────────────────────────────
def main():
    import os, sys
    sys.path.insert(0, "/app")
    os.chdir("/app")

    from app.db import SessionLocal
    from app.models import Employee, Justification
    from sqlalchemy import select

    db = SessionLocal()
    employees = db.scalars(select(Employee).where(Employee.is_active == True)).all()

    vacations = parse_raw()

    inserted = 0
    skipped_dup = 0
    not_found = []
    ambiguous = []

    # traccia gli inserimenti in-session per evitare duplicati nella stessa transazione
    inserted_keys: set[tuple[str, object, object]] = set()

    for name, ranges in vacations:
        match = match_employee(name, employees)

        if match is None:
            not_found.append(name)
            continue
        if isinstance(match, list):
            ambiguous.append((name, [e.full_name for e in match]))
            continue

        emp = match
        for start_date, end_date in ranges:
            key = (emp.id, start_date, end_date)
            if key in inserted_keys:
                skipped_dup += 1
                continue
            # controlla duplicato già in DB
            existing = db.scalar(
                select(Justification).where(
                    Justification.employee_id == emp.id,
                    Justification.justification_type == "FERIE",
                    Justification.start_date == start_date,
                    Justification.end_date == end_date,
                )
            )
            if existing:
                skipped_dup += 1
                continue

            label = f"{start_date} → {end_date}" if start_date != end_date else str(start_date)
            print(f"  {'[DRY]' if DRY_RUN else '[INS]'} {emp.full_name} | {label}")

            if not DRY_RUN:
                j = Justification(
                    id=str(uuid4()),
                    employee_id=emp.id,
                    justification_type="FERIE",
                    description="Ferie estive 2026",
                    start_date=start_date,
                    end_date=end_date,
                    start_time=time(8, 0),
                    end_time=time(17, 0),
                    approval_status="approved",
                    approval_required=False,
                )
                db.add(j)
            inserted_keys.add(key)
            inserted += 1

    if not DRY_RUN:
        db.commit()

    print("\n" + "=" * 60)
    print(f"{'DRY-RUN' if DRY_RUN else 'INSERITI'}: {inserted} | Duplicati saltati: {skipped_dup}")

    if not_found:
        print(f"\n⚠  NON TROVATI ({len(not_found)}):")
        for n in not_found:
            print(f"   - {n}")

    if ambiguous:
        print(f"\n⚠  AMBIGUI — corrispondenze multiple ({len(ambiguous)}):")
        for n, matches in ambiguous:
            print(f"   - '{n}' → {matches}")

    db.close()


if __name__ == "__main__":
    main()

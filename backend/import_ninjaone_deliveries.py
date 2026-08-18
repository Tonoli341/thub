"""
Importa le consegne PC da NinjaOne (campo lastLoggedInUser) verso device_deliveries.

Il file MAPPING sotto è stato curato a mano (vedi conversazione): dispositivi
condivisi/kiosk/admin già esclusi. Il match dipendente è euristico sul nome
(l'utenza AD e' tipicamente iniziale+cognome o nomecognome, tutto attaccato).

Eseguire in due passi:

  1) DRY RUN (nessuna scrittura in device_deliveries, solo report da rivedere):
     sudo docker exec thub-backend-1 python3 /app/import_ninjaone_deliveries.py --dry-run

     Scrive /app/ninjaone_deliveries_review.csv (= backend/ninjaone_deliveries_review.csv
     sull'host, grazie al bind mount). Colonne:
       device_name, ninja_login, status, matched_employee_id, matched_employee_name, note

     status possibili: ready | ambiguous | not_found | device_not_found | already_assigned

  2) Rivedere/correggere a mano il CSV (per le righe ambiguous/not_found si puo'
     incollare a mano l'employee_id corretto in matched_employee_id: verra' comunque
     usata). Per escludere una riga anche se ha un employee_id, scrivere "skip" in status.

  3) APPLY (crea le DeviceDelivery, senza firma -> stato "pending_signature"):
     sudo docker exec thub-backend-1 python3 /app/import_ninjaone_deliveries.py --apply

  4) SIGN (opzionale, solo se vuoi che risultino "aperte" invece di "in attesa
     firma"): applica una firma placeholder (1x1 png trasparente, NON e' una
     firma reale del dipendente) a tutte le consegne create da questo import
     che non hanno ancora una firma. Restano riconoscibili da delivered_by =
     "Import NinjaOne" e dalla nota con il lastLoggedInUser originale.
     sudo docker exec thub-backend-1 python3 /app/import_ninjaone_deliveries.py --sign

Nota: --dry-run e --apply eseguono comunque una sync NinjaOne -> device_assets
(idempotente, serve per avere i device_id aggiornati) prima di procedere.
"""
import csv
import os
import sys
from datetime import datetime, timezone
from uuid import uuid4

REVIEW_CSV_PATH = "/app/ninjaone_deliveries_review.csv"

# device_name, lastLoggedInUser (grezzo da NinjaOne, curato a mano dall'utente)
MAPPING = """
NHQ0016,TONOLI\\IsabellaBonis
NHQ0033,TONOLI\\esairitupa
NHQ0035,TONOLI\\FrancescoRomano
NHQ0036,TONOLI\\StefanoTonoli
NHQ0037,TONOLI\\EnnioTonoli
NHQ0038,TONOLI\\CatherineToniazzo
NHQ0039,TONOLI\\liacomino
NHQ0042,TONOLI\\RaffaeleSinatra
NHQ0046,TONOLI\\MonicaStroppiana
NHQ0048,TONOLI\\alessiapietra
NHQ0049,TONOLI\\raffaellacafasso
NHQ0050,TONOLI\\DavideDeMeo
NHQ0052,TONOLI\\fromano
NHQ0053,TONOLI\\alessiabarra
NHQ0054,TONOLI\\pcurino
NHQ0055,TONOLI\\gmoretto
NK0023,TONOLI\\patriziatalpo
NK0025,TONOLI\\robertoargentini
NK0032,TONOLI\\alessandrobonardo
NK0033,TONOLI\\matteogerbaudo
NK0034,TONOLI\\fiorellabernardinello
NK0035,TONOLI\\FrancescoTonoli
NK0037,TONOLI\\sromano
NK0038,TONOLI\\mallocco
NK0039,TONOLI\\robertoargentini
NK0041,TONOLI\\martinaosella
NK0044,TONOLI\\mtesta
NK0045,TONOLI\\ipupchenko
NK0047,TONOLI\\AlicePorretti
NK0048,TONOLI\\gabriele.bottaro
NK0049,TONOLI\\MarcoZucchetti
NK0050,TONOLI\\MATTIO GIORGIO GIOVANNI
NK0051,TONOLI\\PaoloDalmasso
NK0052,TONOLI\\MarcoDoria
NK0053,TONOLI\\SabinaLovera
NK0054,TONOLI\\enzorivoira
NK0056,TONOLI\\TREZZA RINCON ERNESTO LUIS
NK0057,TONOLI\\GianmariaArmando
NK0059,TONOLI\\agallo
NK0060,TONOLI\\agiordano
NK0061,TONOLI\\domenico napoli
NK0062,TONOLI\\fstefanin
NK0063,TONOLI\\GabrieleZavatteri
NK0064,TONOLI\\pmiglietta
NK0066,TONOLI\\matteogerbaudo
NK0067,TONOLI\\Ortolani Franco David
NK0068,TONOLI\\mallocco
NK0069,TONOLI\\gboiero
NK0070,TONOLI\\proaschio
NK0071,TONOLI\\iborello
""".strip()

PLACEHOLDER_SIGNATURE = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII="
)

MODE = "sign" if "--sign" in sys.argv else ("apply" if "--apply" in sys.argv else "dry-run")
DRY_RUN = MODE == "dry-run"


def _norm(value: str) -> str:
    return "".join(ch for ch in value.lower().strip() if ch.isalnum())


def parse_mapping() -> list[tuple[str, str]]:
    rows = []
    for line in MAPPING.splitlines():
        line = line.strip()
        if not line:
            continue
        device_name, login = line.split(",", 1)
        rows.append((device_name.strip(), login.strip()))
    return rows


def strip_domain(login: str) -> str:
    return login.split("\\", 1)[1] if "\\" in login else login


def match_employees(login: str, employees: list) -> list:
    """Euristica su first_name/last_name: nomecognome, cognomenome, inizialecognome, cognomeiniziale."""
    raw = strip_domain(login)

    if " " in raw:
        # gia' un nome completo tipo "domenico napoli"
        parts = [p for p in raw.lower().split() if p]
        candidates = []
        for emp in employees:
            nome = (emp.first_name or "").lower()
            cognome = (emp.last_name or "").lower()
            full_norm = _norm(emp.full_name or "")
            if _norm(raw) == full_norm or (nome in parts and cognome in parts):
                candidates.append(emp)
        return candidates

    key = _norm(raw)
    candidates = []
    for emp in employees:
        nome = _norm(emp.first_name or "")
        cognome = _norm(emp.last_name or "")
        if not nome or not cognome:
            continue
        variants = {
            nome + cognome,
            cognome + nome,
            (nome[0] + cognome) if nome else "",
            (cognome + nome[0]) if nome else "",
        }
        if key in variants:
            candidates.append(emp)
    return candidates


def device_label(device) -> str:
    label = " ".join(filter(None, [device.brand, device.model])).strip() or device.asset_type
    if device.serial_number:
        return f"{label} (S/N {device.serial_number})"
    return label


def write_review(rows: list[dict]) -> None:
    with open(REVIEW_CSV_PATH, "w", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=["device_name", "ninja_login", "status", "matched_employee_id", "matched_employee_name", "note"],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row)


def read_review() -> list[dict]:
    with open(REVIEW_CSV_PATH, newline="") as f:
        return list(csv.DictReader(f))


def main():
    sys.path.insert(0, "/app")
    os.chdir("/app")

    from sqlalchemy import select
    from app.db import SessionLocal
    from app.models import DeviceAsset, DeviceDelivery, Employee
    from app.services.ninjaone import NinjaOneError, sync_devices

    db = SessionLocal()

    try:
        sync_devices(db)
    except NinjaOneError as exc:
        print(f"ATTENZIONE: sync NinjaOne fallita ({exc}). Procedo con i device_assets gia' presenti a DB.")

    employees = db.scalars(select(Employee).where(Employee.is_active.is_(True))).all()
    devices_by_name = {
        (d.system_name or "").strip().lower(): d
        for d in db.scalars(select(DeviceAsset).where(DeviceAsset.asset_type == "pc", DeviceAsset.is_active.is_(True)))
    }

    if DRY_RUN:
        review_rows = []
        for device_name, login in parse_mapping():
            device = devices_by_name.get(device_name.strip().lower())
            if device is None:
                review_rows.append({
                    "device_name": device_name, "ninja_login": login, "status": "device_not_found",
                    "matched_employee_id": "", "matched_employee_name": "", "note": "device_asset non trovato (sync?)",
                })
                continue

            open_delivery = db.scalar(
                select(DeviceDelivery).where(DeviceDelivery.device_id == device.id, DeviceDelivery.returned_at.is_(None))
            )
            if open_delivery is not None:
                review_rows.append({
                    "device_name": device_name, "ninja_login": login, "status": "already_assigned",
                    "matched_employee_id": "", "matched_employee_name": "", "note": "consegna aperta gia' esistente",
                })
                continue

            matches = match_employees(login, employees)
            if len(matches) == 1:
                emp = matches[0]
                review_rows.append({
                    "device_name": device_name, "ninja_login": login, "status": "ready",
                    "matched_employee_id": emp.id, "matched_employee_name": emp.full_name, "note": "",
                })
            elif len(matches) == 0:
                review_rows.append({
                    "device_name": device_name, "ninja_login": login, "status": "not_found",
                    "matched_employee_id": "", "matched_employee_name": "", "note": "nessun dipendente corrispondente",
                })
            else:
                names = "; ".join(e.full_name for e in matches)
                review_rows.append({
                    "device_name": device_name, "ninja_login": login, "status": "ambiguous",
                    "matched_employee_id": "", "matched_employee_name": "", "note": f"candidati: {names}",
                })

        write_review(review_rows)
        counts = {}
        for r in review_rows:
            counts[r["status"]] = counts.get(r["status"], 0) + 1
        print(f"Report scritto in {REVIEW_CSV_PATH}")
        print("Riepilogo:", counts)
        print("\nRivedi/correggi il CSV, poi rilancia con --apply.")

    elif MODE == "sign":
        pending = db.scalars(
            select(DeviceDelivery).where(
                DeviceDelivery.delivered_by == "Import NinjaOne",
                DeviceDelivery.signature_b64.is_(None),
            )
        ).all()
        for delivery in pending:
            delivery.signature_b64 = PLACEHOLDER_SIGNATURE
            print(f"  [FIRMATA] {delivery.device_label} -> {delivery.employee.full_name if delivery.employee else delivery.employee_id}")
        db.commit()
        print(f"\nFirma placeholder applicata a {len(pending)} consegne (ora in stato 'open').")

    else:
        if not os.path.exists(REVIEW_CSV_PATH):
            print(f"ERRORE: {REVIEW_CSV_PATH} non trovato. Esegui prima --dry-run.")
            db.close()
            return

        rows = read_review()
        inserted = 0
        skipped = 0
        for row in rows:
            status_value = (row.get("status") or "").strip().lower()
            employee_id = (row.get("matched_employee_id") or "").strip()
            device_name = row["device_name"]
            login = row["ninja_login"]

            if status_value == "skip" or not employee_id:
                skipped += 1
                continue

            device = devices_by_name.get(device_name.strip().lower())
            if device is None:
                print(f"  [SALTATO] {device_name}: device_asset non trovato")
                skipped += 1
                continue

            employee = db.get(Employee, employee_id)
            if employee is None or not employee.is_active:
                print(f"  [SALTATO] {device_name}: employee_id {employee_id} non valido/non attivo")
                skipped += 1
                continue

            open_delivery = db.scalar(
                select(DeviceDelivery).where(DeviceDelivery.device_id == device.id, DeviceDelivery.returned_at.is_(None))
            )
            if open_delivery is not None:
                print(f"  [SALTATO] {device_name}: consegna aperta gia' esistente")
                skipped += 1
                continue

            delivery = DeviceDelivery(
                id=str(uuid4()),
                employee_id=employee.id,
                device_id=device.id,
                device_label=device_label(device),
                delivered_by="Import NinjaOne",
                delivered_at=datetime.now(timezone.utc),
                notes=f"Importato da NinjaOne (lastLoggedInUser: {login})",
                signature_b64=None,
            )
            db.add(delivery)
            print(f"  [INS] {device_name} -> {employee.full_name}")
            inserted += 1

        db.commit()
        print(f"\nInserite {inserted} consegne (senza firma, stato pending_signature). Saltate {skipped}.")

    db.close()


if __name__ == "__main__":
    main()

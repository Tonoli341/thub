"""One-off: aggiunge gli attributi richiesti alla tipologia "Frontale" della
categoria "Carrelli elevatori" (creando la tipologia se manca).

Usa le stesse funzioni di app.services.maintenance_assets della UI, quindi
stessa validazione e stesso audit log — non tocca il database con SQL grezzo.
Idempotente: se un field_key esiste già sulla tipologia, lo salta.

Uso:
    cd backend
    ./.venv/bin/python scripts/seed_carrello_frontale_fields.py
"""

from app.db import SessionLocal
from app.enums import MaintenanceFieldType
from app.maintenance_asset_models import MaintenanceAssetClass, MaintenanceAssetType
from app.services import maintenance_assets as service

ASSET_CLASS_CODE = "carrello_elevatore"
ASSET_TYPE_CODE = "frontale"
ASSET_TYPE_LABEL = "Frontale"

FIELDS = [
    ("foto_targa_ce", "Foto targa CE", MaintenanceFieldType.image),
    ("foto_targa_ce_batteria", "Foto targa CE batteria", MaintenanceFieldType.image),
    ("foto_targa_sollevamento_forche", "Foto targa sollevamento forche", MaintenanceFieldType.image),
    ("anno", "Anno", MaintenanceFieldType.text),
    ("investimento", "Investimento", MaintenanceFieldType.text),
    ("portata", "Portata", MaintenanceFieldType.text),
    ("numero_ruote", "Numero ruote", MaintenanceFieldType.text),
    ("dimensioni_ruote_anteriori", "Dimensioni ruote anteriori", MaintenanceFieldType.text),
    ("dimensioni_ruote_posteriori", "Dimensioni ruote posteriori", MaintenanceFieldType.text),
    ("tipo_batteria", "Tipo batteria", MaintenanceFieldType.text),
    ("connessione_spina_ricarica", "Connessione spina di ricarica", MaintenanceFieldType.text),
    ("peso", "Peso", MaintenanceFieldType.text),
    ("tipo_montante", "Tipo montante", MaintenanceFieldType.text),
    ("altezza_castello", "Altezza castello", MaintenanceFieldType.text),
    ("altezza_massima_sollevamento", "Altezza massima di sollevamento", MaintenanceFieldType.text),
    ("dimensione_forche", "Dimensione forche", MaintenanceFieldType.text),
]


def main() -> None:
    with SessionLocal() as db:
        asset_class = db.query(MaintenanceAssetClass).filter_by(code=ASSET_CLASS_CODE).first()
        if asset_class is None:
            raise SystemExit(
                f"Categoria «{ASSET_CLASS_CODE}» non trovata: crea prima la categoria da UI (Manutenzioni · Categorie)."
            )

        asset_type = db.query(MaintenanceAssetType).filter_by(
            asset_class_id=asset_class.id, code=ASSET_TYPE_CODE
        ).first()
        if asset_type is None:
            asset_type = service.create_asset_type(
                db, asset_class, code=ASSET_TYPE_CODE, label=ASSET_TYPE_LABEL, icon="forklift"
            )
            print(f"Creata tipologia «{ASSET_TYPE_LABEL}» sotto «{asset_class.label}».")
        else:
            print(f"Tipologia «{asset_type.label}» già esistente, riuso quella.")

        existing_keys = {f.field_key for f in asset_type.fields}
        created, skipped = 0, 0
        for sort_order, (field_key, label, field_type) in enumerate(FIELDS, start=1):
            if field_key in existing_keys:
                print(f"  - salto «{label}» ({field_key}): esiste già")
                skipped += 1
                continue
            service.create_asset_field(
                db,
                asset_type,
                field_key=field_key,
                label=label,
                field_type=field_type,
                is_required=False,
                is_searchable=True,
                options=[],
                sort_order=sort_order,
            )
            print(f"  + aggiunto «{label}» ({field_key})")
            created += 1

        db.commit()
        print(f"\nFatto: {created} attributi creati, {skipped} già presenti.")


if __name__ == "__main__":
    main()

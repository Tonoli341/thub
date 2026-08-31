import time
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx
from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DeviceAsset, DeviceDelivery
from app.schemas import DeviceSyncResult

REQUEST_TIMEOUT = 30.0

# Mappatura nodeClass NinjaOne -> asset_type interno. Le classi non elencate
# ricadono su "altro" e restano modificabili a mano dalla scheda dispositivo.
NODE_CLASS_TO_ASSET_TYPE = {
    "WINDOWS_WORKSTATION": "pc",
    "MAC": "pc",
    "LINUX_WORKSTATION": "pc",
    "ANDROID": "smartphone",
    "APPLE_IOS": "smartphone",
    "APPLE_IPADOS": "tablet",
}
SYNCED_ASSET_TYPES = {"pc", "smartphone"}

_token_cache: dict[str, object] = {"access_token": None, "expires_at": 0.0}


class NinjaOneError(RuntimeError):
    pass


def _require_configured() -> None:
    if not (settings.ninjaone_base_url and settings.ninjaone_client_id and settings.ninjaone_client_secret):
        raise NinjaOneError("Integrazione NinjaOne non configurata: impostare NINJAONE_CLIENT_ID/SECRET.")


def _get_access_token() -> str:
    _require_configured()
    cached_token = _token_cache.get("access_token")
    if cached_token and float(_token_cache.get("expires_at", 0)) > time.time() + 30:
        return str(cached_token)

    try:
        response = httpx.post(
            f"{settings.ninjaone_base_url.rstrip('/')}/ws/oauth/token",
            data={
                "grant_type": "client_credentials",
                "client_id": settings.ninjaone_client_id,
                "client_secret": settings.ninjaone_client_secret,
                "scope": settings.ninjaone_scope,
            },
            headers={"Content-Type": "application/x-www-form-urlencoded", "Accept": "application/json"},
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        payload = response.json()
    except httpx.HTTPError as exc:
        raise NinjaOneError(f"Autenticazione NinjaOne fallita: {exc}") from exc
    except ValueError as exc:
        raise NinjaOneError(f"Risposta NinjaOne non valida (autenticazione): {exc}") from exc

    access_token = payload.get("access_token")
    if not access_token:
        raise NinjaOneError("Risposta NinjaOne priva di access_token.")
    _token_cache["access_token"] = access_token
    _token_cache["expires_at"] = time.time() + float(payload.get("expires_in", 3600))
    return str(access_token)


def _get(path: str, params: dict | None = None) -> dict:
    token = _get_access_token()
    try:
        response = httpx.get(
            f"{settings.ninjaone_base_url.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params=params,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPError as exc:
        raise NinjaOneError(f"Chiamata NinjaOne {path} fallita: {exc}") from exc
    except ValueError as exc:
        raise NinjaOneError(f"Risposta NinjaOne non valida ({path}): {exc}") from exc


def _post(path: str, json_body: dict) -> dict:
    token = _get_access_token()
    try:
        response = httpx.post(
            f"{settings.ninjaone_base_url.rstrip('/')}{path}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            json=json_body,
            timeout=REQUEST_TIMEOUT,
        )
        response.raise_for_status()
        return response.json()
    except httpx.HTTPStatusError as exc:
        raise NinjaOneError(f"Chiamata NinjaOne {path} rifiutata ({exc.response.status_code}): {exc.response.text}") from exc
    except httpx.HTTPError as exc:
        raise NinjaOneError(f"Chiamata NinjaOne {path} fallita: {exc}") from exc
    except ValueError as exc:
        raise NinjaOneError(f"Risposta NinjaOne non valida ({path}): {exc}") from exc


def create_ticket(*, subject: str, description: str, priority: str) -> dict:
    """Apre un ticket su NinjaOne per l'organizzazione fissa configurata
    (settings.ninjaone_organization_id). Ritorna il payload di risposta di
    NinjaOne (contiene l'id del ticket creato)."""
    if not settings.ninjaone_organization_id:
        raise NinjaOneError("Integrazione ticketing NinjaOne non configurata: impostare NINJAONE_ORGANIZATION_ID.")
    return _post(
        "/v2/ticketing/ticket",
        {
            "clientId": int(settings.ninjaone_organization_id),
            "subject": subject,
            "description": {"public": True, "body": description, "type": "TEXT"},
            "priority": priority,
            "status": "OPEN",
        },
    )


def _clean_text(value: object) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        value = str(value)
    normalized = value.strip()
    if not normalized or normalized.lower() in {"none", "null", "n/a", "na", "unknown"}:
        return None
    return normalized


def _normalize_serial(value: object) -> str | None:
    normalized = _clean_text(value)
    if normalized is None:
        return None
    if normalized.casefold() in {
        "chassis serial number",
        "default string",
        "system serial number",
        "to be filled by o.e.m.",
    }:
        return None
    return normalized


def fetch_devices() -> list[dict]:
    payload = _get("/v2/devices-detailed", params={"pageSize": 1000})
    return payload if isinstance(payload, list) else payload.get("results", [])


def _map_asset_type(node_class: str | None) -> str:
    return NODE_CLASS_TO_ASSET_TYPE.get((node_class or "").upper(), "altro")


@dataclass
class _NinjaDeviceRecord:
    ninja_device_id: str
    asset_type: str
    node_class: str | None
    system_name: str | None
    brand: str | None
    model: str | None
    serial_number: str | None
    imei: str | None
    iccid: str | None
    phone_number: str | None


def _walk_strings(value: object):
    if isinstance(value, dict):
        for key, nested in value.items():
            yield key, nested
            yield from _walk_strings(nested)
    elif isinstance(value, list):
        for nested in value:
            yield from _walk_strings(nested)


def _extract_first_text(payload: dict, candidate_keys: tuple[str, ...], *, normalize_serial: bool = False) -> str | None:
    candidate_keys_folded = {key.casefold() for key in candidate_keys}
    for key, value in _walk_strings(payload):
        if not isinstance(key, str) or key.casefold() not in candidate_keys_folded:
            continue
        normalized = _normalize_serial(value) if normalize_serial else _clean_text(value)
        if normalized:
            return normalized
    return None


def _build_records(devices: list[dict]) -> list[_NinjaDeviceRecord]:
    records: list[_NinjaDeviceRecord] = []
    for device in devices:
        device_id = device.get("id")
        if device_id is None:
            continue
        node_class = device.get("nodeClass")
        asset_type = _map_asset_type(node_class)
        if asset_type not in SYNCED_ASSET_TYPES:
            continue
        system = device.get("system") or {}
        records.append(
            _NinjaDeviceRecord(
                ninja_device_id=str(device_id),
                asset_type=asset_type,
                node_class=_clean_text(node_class),
                system_name=_clean_text(device.get("systemName") or device.get("dnsName")),
                brand=_clean_text(system.get("manufacturer")),
                model=_clean_text(system.get("model")),
                serial_number=_normalize_serial(
                    system.get("serialNumber") or system.get("biosSerialNumber") or system.get("assetSerialNumber")
                ),
                imei=_extract_first_text(
                    device,
                    ("imei", "imei1", "imei2", "primaryImei", "secondaryImei", "deviceImei"),
                ),
                iccid=_extract_first_text(
                    device,
                    ("iccid", "simSerialNumber", "simCardSerialNumber", "uiccId"),
                ),
                phone_number=_extract_first_text(
                    device,
                    ("phoneNumber", "line1Number", "mobileNumber", "msisdn"),
                ),
            )
        )
    return records


def _cleanup_unsupported_assets(db: Session) -> None:
    delivered_ids = select(DeviceDelivery.device_id)
    db.execute(
        delete(DeviceAsset).where(
            DeviceAsset.asset_type.not_in(SYNCED_ASSET_TYPES),
            DeviceAsset.id.not_in(delivered_ids),
        )
    )
    for asset in db.scalars(
        select(DeviceAsset).where(
            DeviceAsset.asset_type.not_in(SYNCED_ASSET_TYPES),
            DeviceAsset.id.in_(delivered_ids),
        )
    ):
        asset.is_active = False


def sync_devices(db: Session) -> DeviceSyncResult:
    _cleanup_unsupported_assets(db)
    devices = fetch_devices()
    records = _build_records(devices)
    ninja_ids = [record.ninja_device_id for record in records]
    existing = {
        asset.ninja_device_id: asset
        for asset in db.scalars(select(DeviceAsset).where(DeviceAsset.ninja_device_id.in_(ninja_ids))).all()
    }

    created = 0
    updated = 0
    for record in records:
        asset = existing.get(record.ninja_device_id)
        if asset is None:
            asset = DeviceAsset(
                ninja_device_id=record.ninja_device_id,
                asset_type=record.asset_type,
                node_class=record.node_class,
                system_name=record.system_name,
                brand=record.brand,
                model=record.model,
                serial_number=record.serial_number,
                imei=record.imei,
                iccid=record.iccid,
                phone_number=record.phone_number,
                is_active=True,
            )
            db.add(asset)
            created += 1
            continue

        asset.node_class = record.node_class
        asset.system_name = record.system_name
        if record.brand:
            asset.brand = record.brand
        if record.model:
            asset.model = record.model
        if record.serial_number:
            asset.serial_number = record.serial_number
        if record.imei:
            asset.imei = record.imei
        if record.iccid:
            asset.iccid = record.iccid
        if record.phone_number:
            asset.phone_number = record.phone_number
        updated += 1

    db.commit()
    return DeviceSyncResult(fetched=len(records), created=created, updated=updated, synced_at=datetime.now(timezone.utc))

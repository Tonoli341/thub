"""QR code per asset del modulo Manutenzioni: generazione/rigenerazione del
token (protetta), pagina pubblica raggiunta scansionando il QR (senza auth).

Dal 2026-09-03 (manutenzioni.md §18) la pagina pubblica espone tutta
l'anagrafica (custom_fields con nomi risolti, foto, contaore), dei documenti
solo tipo e note e delle note asset testo, autore e data: i test coprono
anche l'endpoint immagine pubblica, incluso il caso IDOR (immagine di un
altro asset)."""

import pytest

from app.enums import MaintenanceDocumentStatus
from app.maintenance_asset_models import MaintenanceDocument
from app.services import smb_storage
from tests.conftest import auth_headers, make_admin_token, make_employee


class _FakeSmbStore:
    """Stesso pattern di test_maintenance_documents.py: niente fileserver SMB
    reale nei test, solo dizionario in memoria."""

    def __init__(self):
        self.files: dict[str, bytes] = {}

    def write(self, relative_path, content):
        self.files[relative_path] = content

    def read(self, relative_path):
        return self.files[relative_path]

    def delete(self, relative_path):
        del self.files[relative_path]


@pytest.fixture()
def fake_smb(monkeypatch):
    store = _FakeSmbStore()
    monkeypatch.setattr(smb_storage, "write_image", store.write)
    monkeypatch.setattr(smb_storage, "read_image", store.read)
    monkeypatch.setattr(smb_storage, "delete_image", store.delete)
    return store


def _create_asset(client, admin_headers):
    asset_family = client.post(
        "/api/maintenance/asset-families",
        json={"code": "sollevamento_qr", "label": "Sollevamento QR"},
        headers=admin_headers,
    ).json()
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "carrello_qr", "label": "Carrello QR"},
        headers=admin_headers,
    ).json()
    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale_qr", "label": "Frontale QR"},
        headers=admin_headers,
    ).json()
    asset = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "internal_code": "QR-001", "custom_fields": {}},
        headers=admin_headers,
    ).json()
    return asset


def test_regenerate_qr_token_creates_and_invalidates_previous(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    assert asset["has_qr_token"] is False

    first = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers)
    assert first.status_code == 200
    first_token = first.json()["qr_token"]
    assert first_token

    # Il token generato è già valido sulla pagina pubblica.
    public_resp = client.get(f"/api/maintenance/assets/public/{first_token}")
    assert public_resp.status_code == 200

    second = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers)
    second_token = second.json()["qr_token"]
    assert second_token != first_token

    # Il token precedente non funziona più: rigenerare invalida il vecchio.
    stale_resp = client.get(f"/api/maintenance/assets/public/{first_token}")
    assert stale_resp.status_code == 400

    fresh_resp = client.get(f"/api/maintenance/assets/public/{second_token}")
    assert fresh_resp.status_code == 200

    asset_after = client.get(f"/api/maintenance/assets/{asset['id']}", headers=headers).json()
    assert asset_after["has_qr_token"] is True


def test_get_qr_token_requires_admin_and_404_before_generation(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    resp = client.get(f"/api/maintenance/assets/{asset['id']}/qr-token", headers=headers)
    assert resp.status_code == 400

    client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers)
    resp_ok = client.get(f"/api/maintenance/assets/{asset['id']}/qr-token", headers=headers)
    assert resp_ok.status_code == 200
    assert resp_ok.json()["public_url_path"].startswith("/manutenzioni/asset-pubblico/")


def test_public_asset_page_invalid_token_404(client, db_session):
    resp = client.get("/api/maintenance/assets/public/token-inesistente")
    assert resp.status_code == 400


def test_public_asset_page_exposes_only_safe_fields(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)
    client.patch(
        f"/api/maintenance/assets/{asset['id']}",
        json={"custom_fields": {}},
        headers=headers,
    )
    regen = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers)
    qr_token = regen.json()["qr_token"]

    resp = client.get(f"/api/maintenance/assets/public/{qr_token}")
    assert resp.status_code == 200
    payload = resp.json()

    assert set(payload.keys()) == {
        "internal_code",
        "asset_type_label",
        "asset_class_label",
        "status",
        "status_reason",
        "deadlines",
        "custom_field_values",
        "images",
        "documents",
        "notes",
        "counters",
    }
    assert payload["internal_code"] == "QR-001"
    assert payload["deadlines"] == []
    assert payload["custom_field_values"] == []
    assert payload["images"] == []
    assert payload["documents"] == []
    assert payload["notes"] == []
    assert payload["counters"] == []


def test_public_asset_page_lists_only_document_type_and_notes(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)
    document = MaintenanceDocument(
        asset_id=asset["id"],
        doc_type="Certificato CE",
        title="Verificato il 03/09/2026",
        status=MaintenanceDocumentStatus.rilasciato,
        is_photo=False,
        file_path=f"{asset['id']}/documento.pdf",
        original_filename="certificato-riservato.pdf",
        mime_type="application/pdf",
        size_bytes=1234,
        uploaded_by="admin",
    )
    db_session.add(document)
    db_session.commit()
    qr_token = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers).json()[
        "qr_token"
    ]

    response = client.get(f"/api/maintenance/assets/public/{qr_token}")

    assert response.status_code == 200
    assert response.json()["documents"] == [
        {"document_type": "Certificato CE", "notes": "Verificato il 03/09/2026"}
    ]


def test_public_asset_page_lists_note_text_author_and_date(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)
    client.post(
        f"/api/maintenance/assets/{asset['id']}/comments",
        json={"text": "Attendere il ricambio ordinato."},
        headers=headers,
    )
    qr_token = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers).json()[
        "qr_token"
    ]

    response = client.get(f"/api/maintenance/assets/public/{qr_token}")

    assert response.status_code == 200
    notes = response.json()["notes"]
    assert len(notes) == 1
    assert notes[0]["text"] == "Attendere il ricambio ordinato."
    assert notes[0]["created_by"] == "sysadmin"
    assert notes[0]["created_at"]
    assert set(notes[0]) == {"text", "created_by", "created_at"}


def test_public_asset_page_lists_active_deadlines(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)
    client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "Revisione periodica", "due_date": "2027-01-01"},
        headers=headers,
    )
    regen = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers)
    qr_token = regen.json()["qr_token"]

    resp = client.get(f"/api/maintenance/assets/public/{qr_token}")
    assert resp.status_code == 200
    deadlines = resp.json()["deadlines"]
    assert len(deadlines) == 1
    assert deadlines[0]["deadline_type"] == "Revisione periodica"
    assert deadlines[0]["due_date"] == "2027-01-01"


def test_public_asset_page_exposes_custom_fields_with_resolved_employee_name(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    employee = make_employee(db_session, tms_id="EMP-QR-1", full_name="Mario Rossi")
    db_session.commit()

    asset_family = client.post(
        "/api/maintenance/asset-families",
        json={"code": "sollevamento_qr2", "label": "Sollevamento QR 2"},
        headers=headers,
    ).json()
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "carrello_qr2", "label": "Carrello QR 2"},
        headers=headers,
    ).json()
    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale_qr2", "label": "Frontale QR 2"},
        headers=headers,
    ).json()
    client.post(
        f"/api/maintenance/asset-types/{asset_type['id']}/fields",
        json={"field_key": "responsible_employee_id", "label": "Responsabile", "field_type": "employee"},
        headers=headers,
    )
    client.post(
        f"/api/maintenance/asset-types/{asset_type['id']}/fields",
        json={"field_key": "targa", "label": "Targa", "field_type": "text"},
        headers=headers,
    )
    asset = client.post(
        "/api/maintenance/assets",
        json={
            "asset_type_id": asset_type["id"],
            "internal_code": "QR-002",
            "custom_fields": {"responsible_employee_id": employee.id, "targa": "AB123CD"},
        },
        headers=headers,
    ).json()
    qr_token = client.post(f"/api/maintenance/assets/{asset['id']}/qr-token/regenerate", headers=headers).json()[
        "qr_token"
    ]

    resp = client.get(f"/api/maintenance/assets/public/{qr_token}")
    assert resp.status_code == 200
    values = {f["field_key"]: f["value"] for f in resp.json()["custom_field_values"]}
    assert values["responsible_employee_id"] == "Mario Rossi"
    assert values["targa"] == "AB123CD"


def test_public_asset_image_endpoint_rejects_image_of_another_asset(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_a = _create_asset(client, headers)
    qr_token_a = client.post(f"/api/maintenance/assets/{asset_a['id']}/qr-token/regenerate", headers=headers).json()[
        "qr_token"
    ]

    asset_family = client.post(
        "/api/maintenance/asset-families",
        json={"code": "sollevamento_qr3", "label": "Sollevamento QR 3"},
        headers=headers,
    ).json()
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "carrello_qr3", "label": "Carrello QR 3"},
        headers=headers,
    ).json()
    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale_qr3", "label": "Frontale QR 3"},
        headers=headers,
    ).json()
    asset_b = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "internal_code": "QR-003", "custom_fields": {}},
        headers=headers,
    ).json()
    qr_token_b = client.post(f"/api/maintenance/assets/{asset_b['id']}/qr-token/regenerate", headers=headers).json()[
        "qr_token"
    ]

    photo = client.post(
        f"/api/maintenance/assets/{asset_b['id']}/photos",
        data={"title": "Foto B"},
        files={"file": ("foto.jpg", b"\xff\xd8\xff fake jpeg", "image/jpeg")},
        headers=headers,
    ).json()

    # Token valido di un asset diverso da quello dell'immagine: deve fallire,
    # non basta che l'image_id esista (niente IDOR).
    resp = client.get(f"/api/maintenance/assets/public/{qr_token_a}/images/{photo['id']}")
    assert resp.status_code == 400

    # Con il token corretto invece funziona.
    resp_ok = client.get(f"/api/maintenance/assets/public/{qr_token_b}/images/{photo['id']}")
    assert resp_ok.status_code == 200


def test_public_asset_image_endpoint_404_on_invalid_token(client, db_session):
    resp = client.get("/api/maintenance/assets/public/token-inesistente/images/qualsiasi-id")
    assert resp.status_code == 400

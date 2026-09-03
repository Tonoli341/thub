"""I test non parlano mai con un vero fileserver SMB: services.smb_storage è
sostituito da un fake in memoria, coerente con la regola che vieta ai test di
toccare sistemi esterni reali (LDAP, MSSQL, SMTP — qui SMB)."""

import pytest

from app.services import smb_storage
from tests.conftest import auth_headers, make_admin_token


class FakeSmbStore:
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
    store = FakeSmbStore()
    monkeypatch.setattr(smb_storage, "write_document", store.write)
    monkeypatch.setattr(smb_storage, "read_document", store.read)
    monkeypatch.setattr(smb_storage, "delete_document", store.delete)
    return store


def _create_asset(client, headers, document_type_options=("certificato_ce",)):
    asset_class = client.post(
        "/api/maintenance/asset-classes",
        json={"code": "carrello_elevatore", "label": "Carrello elevatore"},
        headers=headers,
    ).json()
    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale", "label": "Frontale"},
        headers=headers,
    ).json()
    client.patch(
        f"/api/maintenance/asset-types/{asset_type['id']}",
        json={"document_type_options": list(document_type_options)},
        headers=headers,
    )
    asset = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {}},
        headers=headers,
    ).json()
    return asset


def test_upload_rejects_disallowed_mime_type(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    resp = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "certificato_ce", "title": "Certificato CE"},
        files={"file": ("virus.exe", b"contenuto", "application/x-msdownload")},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "non ammesso" in resp.json()["detail"]


def test_upload_does_not_supersede_previous_documents(client, db_session, fake_smb):
    """Senza versionamento (deciso il 2026-09-03), più documenti dello stesso
    doc_type restano tutti "rilasciato": nessun upload retrocede gli altri."""
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    first = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "certificato_ce", "title": "Certificato CE 2024"},
        files={"file": ("certificato.pdf", b"contenuto v1", "application/pdf")},
        headers=headers,
    ).json()
    assert first["status"] == "rilasciato"

    second = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "certificato_ce", "title": "Certificato CE 2026"},
        files={"file": ("certificato.pdf", b"contenuto v2", "application/pdf")},
        headers=headers,
    ).json()
    assert second["status"] == "rilasciato"

    documents = client.get(f"/api/maintenance/assets/{asset['id']}/documents", headers=headers).json()
    assert len(documents) == 2
    assert {doc["id"] for doc in documents} == {first["id"], second["id"]}


def test_document_status_can_be_changed_manually(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    document = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "certificato_ce", "title": "Certificato CE"},
        files={"file": ("certificato.pdf", b"contenuto", "application/pdf")},
        headers=headers,
    ).json()

    updated = client.patch(
        f"/api/maintenance/documents/{document['id']}/status",
        json={"status": "obsoleto"},
        headers=headers,
    ).json()
    assert updated["status"] == "obsoleto"

    active_only = client.get(f"/api/maintenance/assets/{asset['id']}/documents", headers=headers).json()
    assert active_only == []

    with_obsolete = client.get(
        f"/api/maintenance/assets/{asset['id']}/documents",
        params={"include_obsolete": True},
        headers=headers,
    ).json()
    assert len(with_obsolete) == 1
    assert with_obsolete[0]["status"] == "obsoleto"


def test_download_returns_stored_content(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    document = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "certificato_ce", "title": "Certificato CE"},
        files={"file": ("certificato.pdf", b"contenuto originale", "application/pdf")},
        headers=headers,
    ).json()

    resp = client.get(f"/api/maintenance/documents/{document['id']}/download", headers=headers)
    assert resp.status_code == 200
    assert resp.content == b"contenuto originale"


def test_delete_requires_reason_and_admin(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    document = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "certificato_ce", "title": "Certificato CE"},
        files={"file": ("certificato.pdf", b"contenuto", "application/pdf")},
        headers=headers,
    ).json()

    resp = client.request(
        "DELETE",
        f"/api/maintenance/documents/{document['id']}",
        json={"reason": "Caricato per errore"},
        headers=headers,
    )
    assert resp.status_code == 204

    documents = client.get(f"/api/maintenance/assets/{asset['id']}/documents", headers=headers).json()
    assert documents == []


def test_upload_rejects_doc_type_not_in_asset_type_options(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers, document_type_options=("certificato_ce",))

    resp = client.post(
        f"/api/maintenance/assets/{asset['id']}/documents",
        data={"doc_type": "inesistente", "title": "Documento"},
        files={"file": ("certificato.pdf", b"contenuto", "application/pdf")},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "non riconosciuto" in resp.json()["detail"]


def test_photos_are_separate_from_documents(client, db_session, fake_smb):
    """§3: le foto libere non passano dalla value list document_type_options
    e non compaiono tra i Documenti, solo tra le Foto."""
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    photo = client.post(
        f"/api/maintenance/assets/{asset['id']}/photos",
        data={"title": "Vista laterale"},
        files={"file": ("foto.jpg", b"contenuto foto", "image/jpeg")},
        headers=headers,
    ).json()
    assert photo["is_photo"] is True

    documents = client.get(f"/api/maintenance/assets/{asset['id']}/documents", headers=headers).json()
    assert documents == []

    photos = client.get(f"/api/maintenance/assets/{asset['id']}/photos", headers=headers).json()
    assert len(photos) == 1
    assert photos[0]["id"] == photo["id"]


def test_multiple_photos_do_not_supersede_each_other(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    for name in ("Vista frontale", "Vista laterale"):
        client.post(
            f"/api/maintenance/assets/{asset['id']}/photos",
            data={"title": name},
            files={"file": ("foto.jpg", b"contenuto", "image/jpeg")},
            headers=headers,
        )

    photos = client.get(f"/api/maintenance/assets/{asset['id']}/photos", headers=headers).json()
    assert len(photos) == 2
    assert all(p["status"] == "rilasciato" for p in photos)


def test_main_image_upload_replace_and_remove(client, db_session, fake_smb):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset = _create_asset(client, headers)

    updated = client.post(
        f"/api/maintenance/assets/{asset['id']}/main-image",
        files={"file": ("copertina.jpg", b"copertina v1", "image/jpeg")},
        headers=headers,
    ).json()
    assert updated["main_image_document_id"] is not None
    first_document_id = updated["main_image_document_id"]

    replaced = client.post(
        f"/api/maintenance/assets/{asset['id']}/main-image",
        files={"file": ("copertina2.jpg", b"copertina v2", "image/jpeg")},
        headers=headers,
    ).json()
    assert replaced["main_image_document_id"] != first_document_id

    removed = client.delete(f"/api/maintenance/assets/{asset['id']}/main-image", headers=headers).json()
    assert removed["main_image_document_id"] is None

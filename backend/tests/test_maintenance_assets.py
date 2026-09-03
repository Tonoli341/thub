from tests.conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def _create_class_with_responsible_field(client, admin_headers):
    """Famiglia -> classe con l'attributo generico "responsible_employee_id"
    di tipo "employee" -> sottoclasse. Stesso schema di _create_class_with_brand_field,
    ma per verificare il tipo di campo "riferimento a dipendente" (ex colonna
    fissa responsible_employee_id, ora attributo di classe come department/site)."""
    asset_family = _create_family(client, admin_headers, code="antincendio2", label="Antincendio 2")
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "estintori2", "label": "Estintori 2"},
        headers=admin_headers,
    ).json()

    resp = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/fields",
        json={
            "field_key": "responsible_employee_id",
            "label": "Responsabile",
            "field_type": "employee",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 0,
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201
    return asset_class


def _create_family(client, admin_headers, code="sollevamento", label="Sollevamento"):
    resp = client.post(
        "/api/maintenance/asset-families",
        json={"code": code, "label": label},
        headers=admin_headers,
    )
    assert resp.status_code == 201
    return resp.json()


def _create_class_with_brand_field(client, admin_headers):
    """Famiglia -> classe con l'attributo generico "brand" -> sottoclasse.
    "brand" non è più una colonna fissa di MaintenanceAsset: qui vive come
    campo di classe, condiviso da tutte le sottoclassi della classe."""
    asset_family = _create_family(client, admin_headers)
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "carrello_elevatore", "label": "Carrello elevatore"},
        headers=admin_headers,
    ).json()

    resp = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/fields",
        json={
            "field_key": "brand",
            "label": "Produttore",
            "field_type": "text",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 0,
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201
    return asset_class


def _create_type_with_field(client, admin_headers):
    asset_class = _create_class_with_brand_field(client, admin_headers)

    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale", "label": "Frontale"},
        headers=admin_headers,
    ).json()

    resp = client.post(
        f"/api/maintenance/asset-types/{asset_type['id']}/fields",
        json={
            "field_key": "portata_kg",
            "label": "Portata nominale (kg)",
            "field_type": "number",
            "is_required": True,
            "is_searchable": True,
            "options": [],
            "sort_order": 10,
        },
        headers=admin_headers,
    )
    assert resp.status_code == 201
    return resp.json()


def test_create_asset_requires_maintenance_access(client, db_session):
    make_admin_token(db_session)
    resp = client.get("/api/maintenance/assets")
    assert resp.status_code == 401  # nessun token


def test_maintenance_access_denied_without_permission(client, db_session):
    employee = make_employee(db_session, tms_id="E1", full_name="Mario Rossi")
    token = make_linked_user_token(db_session, employee, username="mario")
    resp = client.get("/api/maintenance/assets", headers=auth_headers(token))
    assert resp.status_code == 403


def test_create_asset_validates_required_custom_field(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_type = _create_type_with_field(client, headers)

    resp = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {"brand": "Toyota"}},
        headers=headers,
    )
    assert resp.status_code == 400
    assert "obbligatorio" in resp.json()["detail"]

    resp = client.post(
        "/api/maintenance/assets",
        json={
            "asset_type_id": asset_type["id"],
            "custom_fields": {"brand": "Toyota", "model": "8FBE20", "portata_kg": 2000},
        },
        headers=headers,
    )
    assert resp.status_code == 201
    asset = resp.json()
    assert asset["internal_code"].startswith("CE-")
    assert asset["custom_fields"]["portata_kg"] == 2000
    assert asset["custom_fields"]["brand"] == "Toyota"
    assert asset["asset_type_label"] == "Frontale"
    assert asset["asset_class_label"] == "Carrello elevatore"


def test_update_asset_records_history_and_requires_reason_is_optional(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_type = _create_type_with_field(client, headers)
    asset = client.post(
        "/api/maintenance/assets",
        json={
            "asset_type_id": asset_type["id"],
            "custom_fields": {"brand": "Toyota", "portata_kg": 1500},
        },
        headers=headers,
    ).json()

    resp = client.patch(
        f"/api/maintenance/assets/{asset['id']}",
        json={
            "custom_fields": {"brand": "Toyota", "portata_kg": 1500, "site": "Fossano"},
            "change_reason": "Trasferimento programmato",
        },
        headers=headers,
    )
    assert resp.status_code == 200
    assert resp.json()["custom_fields"]["site"] == "Fossano"

    history = client.get(f"/api/maintenance/assets/{asset['id']}/history", headers=headers).json()
    assert len(history) == 1
    assert history[0]["changed_field"] == "site"
    assert history[0]["new_value"] == "Fossano"
    assert history[0]["reason"] == "Trasferimento programmato"


def test_asset_comment_roundtrip(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_type = _create_type_with_field(client, headers)
    asset = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {"brand": "Toyota", "portata_kg": 1500}},
        headers=headers,
    ).json()

    resp = client.get(f"/api/maintenance/assets/{asset['id']}/comments", headers=headers)
    assert resp.status_code == 200
    assert resp.json() == []

    client.patch(
        f"/api/maintenance/assets/{asset['id']}",
        json={"status": "in_manutenzione", "status_reason": "Guasto sollevatore"},
        headers=headers,
    )

    resp = client.post(
        f"/api/maintenance/assets/{asset['id']}/comments",
        json={"text": "Atteso ricambio, intervento previsto il 10/9"},
        headers=headers,
    )
    assert resp.status_code == 201
    comment = resp.json()
    assert comment["text"] == "Atteso ricambio, intervento previsto il 10/9"
    assert comment["created_by"]
    assert comment["status"] == "in_manutenzione"
    assert comment["status_reason"] == "Guasto sollevatore"

    comments = client.get(f"/api/maintenance/assets/{asset['id']}/comments", headers=headers).json()
    assert len(comments) == 1
    assert comments[0]["id"] == comment["id"]


def test_search_matches_custom_field_value(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_type = _create_type_with_field(client, headers)
    client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {"brand": "Linde", "portata_kg": 3000}},
        headers=headers,
    )

    resp = client.get("/api/maintenance/assets", params={"search": "linde"}, headers=headers)
    assert resp.status_code == 200
    assert len(resp.json()) == 1


def test_counter_reading_roundtrip(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_type = _create_type_with_field(client, headers)
    asset = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {"brand": "Toyota", "portata_kg": 1800}},
        headers=headers,
    ).json()

    resp = client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": "2026-08-20", "value": 1234.5, "unit": "ore"},
        headers=headers,
    )
    assert resp.status_code == 201

    readings = client.get(f"/api/maintenance/assets/{asset['id']}/counters", headers=headers).json()
    assert len(readings) == 1
    assert readings[0]["value"] == 1234.5


def test_export_asset_counters_xlsx(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_type = _create_type_with_field(client, headers)
    asset = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": asset_type["id"], "custom_fields": {"brand": "Toyota", "portata_kg": 1800}},
        headers=headers,
    ).json()
    client.post(
        f"/api/maintenance/assets/{asset['id']}/counters",
        json={"reading_date": "2026-08-20", "value": 1234.5, "unit": "ore"},
        headers=headers,
    )

    resp = client.get("/api/maintenance/assets/counters/export", headers=headers)
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def test_two_types_in_same_category_have_independent_fields(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_family = _create_family(client, headers)
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "carrello_elevatore", "label": "Carrello elevatore"},
        headers=headers,
    ).json()

    frontale = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "frontale", "label": "Frontale"},
        headers=headers,
    ).json()
    retrattile = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "retrattile", "label": "Retrattile"},
        headers=headers,
    ).json()

    client.post(
        f"/api/maintenance/asset-types/{frontale['id']}/fields",
        json={"field_key": "altezza_montante_mm", "label": "Altezza montante", "field_type": "number", "sort_order": 0},
        headers=headers,
    )

    # Lo stesso campo su un'altra tipologia non collide (chiave unica per tipologia, non per categoria)
    resp = client.post(
        f"/api/maintenance/asset-types/{retrattile['id']}/fields",
        json={"field_key": "altezza_montante_mm", "label": "Altezza montante", "field_type": "number", "sort_order": 0},
        headers=headers,
    )
    assert resp.status_code == 201

    # Creare un asset sulla tipologia retrattile con un campo esistente solo su frontale fallisce
    resp = client.post(
        "/api/maintenance/assets",
        json={"asset_type_id": retrattile["id"], "custom_fields": {"campo_inesistente": 1}},
        headers=headers,
    )
    assert resp.status_code == 400


def test_class_field_lifecycle_create_update_delete(client, db_session):
    """Attributo generico di classe: creazione, modifica (con field_key
    ignorato se presente nel payload, mai rinominabile) ed eliminazione."""
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset_family = _create_family(client, headers, code="antincendio", label="Antincendio")
    asset_class = client.post(
        f"/api/maintenance/asset-families/{asset_family['id']}/classes",
        json={"code": "estintori", "label": "Estintori"},
        headers=headers,
    ).json()

    create_resp = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/fields",
        json={
            "field_key": "serial_number",
            "label": "Numero di serie",
            "field_type": "text",
            "is_required": False,
            "is_searchable": True,
            "options": [],
            "sort_order": 0,
        },
        headers=headers,
    )
    assert create_resp.status_code == 201
    created_class = create_resp.json()
    field = next(f for f in created_class["fields"] if f["field_key"] == "serial_number")

    # field_key nel payload di update viene ignorato senza generare errore:
    # MaintenanceAssetFieldUpdate non lo espone nemmeno come campo.
    update_resp = client.patch(
        f"/api/maintenance/asset-fields/{field['id']}",
        json={
            "field_key": "should_be_ignored",
            "label": "Numero di serie (aggiornato)",
            "is_required": True,
        },
        headers=headers,
    )
    assert update_resp.status_code == 200
    updated_field = update_resp.json()
    assert updated_field["field_key"] == "serial_number"
    assert updated_field["label"] == "Numero di serie (aggiornato)"
    assert updated_field["is_required"] is True

    delete_resp = client.delete(f"/api/maintenance/asset-fields/{field['id']}", headers=headers)
    assert delete_resp.status_code == 204

    classes = client.get("/api/maintenance/asset-classes", headers=headers).json()
    refreshed_class = next(c for c in classes if c["id"] == asset_class["id"])
    assert refreshed_class["fields"] == []


def test_employee_field_resolves_name_and_validates_existing_employee(client, db_session):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    employee = make_employee(db_session, tms_id="E100", full_name="Luca Bianchi")

    asset_class = _create_class_with_responsible_field(client, headers)
    asset_type = client.post(
        f"/api/maintenance/asset-classes/{asset_class['id']}/types",
        json={"code": "estintore_polvere", "label": "Estintore a polvere"},
        headers=headers,
    ).json()

    resp = client.post(
        "/api/maintenance/assets",
        json={
            "asset_type_id": asset_type["id"],
            "custom_fields": {"responsible_employee_id": employee.id},
        },
        headers=headers,
    )
    assert resp.status_code == 201
    asset = resp.json()
    assert asset["custom_fields"]["responsible_employee_id"] == employee.id
    assert asset["employee_field_names"]["responsible_employee_id"] == "Luca Bianchi"

    # Un id dipendente inesistente è un errore di validazione (DomainError -> 400)
    resp_invalid = client.post(
        "/api/maintenance/assets",
        json={
            "asset_type_id": asset_type["id"],
            "custom_fields": {"responsible_employee_id": "non-esiste"},
        },
        headers=headers,
    )
    assert resp_invalid.status_code == 400
    assert "Dipendente non trovato" in resp_invalid.json()["detail"]

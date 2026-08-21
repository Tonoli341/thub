"""Unicità degli incroci Infinity / Cliente-Fornitore.

Lo stesso cliente sulla stessa voce Infinity va rendicontato in luoghi diversi
(es. Dronero TONOLI EXTRA e Rossana TONOLI EXTRA): area operativa e immobili
fanno parte dell'identità dell'incrocio, non sono solo attributi.
"""

from app.models import InfinityBillingItem, OperationalArea
from tests.conftest import auth_headers, make_admin_token

ENDPOINT = "/api/infinity-billing-customer-supplier-map"


def make_item(db, *, name="TONOLI EXTRA") -> str:
    item = InfinityBillingItem(name=name)
    db.add(item)
    db.commit()
    return item.id


def make_area(db, *, name, area_code, buildings=None) -> str:
    area = OperationalArea(name=name, area_code=area_code, buildings=buildings or [])
    db.add(area)
    db.commit()
    return area.id


def payload(item_id, *, area_id=None, buildings=None, jupiter=None) -> dict:
    return {
        "infinity_billing_item_id": item_id,
        "customer_supplier_code": "TE",
        "customer_supplier_description": "TONOLI EXTRA",
        "jupiter_description": jupiter,
        "operational_area_id": area_id,
        "buildings": buildings or [],
    }


def test_stesso_cliente_e_voce_su_aree_diverse(client, db_session):
    token = make_admin_token(db_session)
    item_id = make_item(db_session)
    dronero = make_area(db_session, name="Dronero", area_code="DRO")
    rossana = make_area(db_session, name="Rossana", area_code="ROS")

    first = client.post(ENDPOINT, json=payload(item_id, area_id=dronero), headers=auth_headers(token))
    second = client.post(ENDPOINT, json=payload(item_id, area_id=rossana), headers=auth_headers(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text


def test_incrocio_identico_resta_in_conflitto(client, db_session):
    token = make_admin_token(db_session)
    item_id = make_item(db_session)
    dronero = make_area(db_session, name="Dronero", area_code="DRO")

    client.post(ENDPOINT, json=payload(item_id, area_id=dronero), headers=auth_headers(token))
    duplicate = client.post(ENDPOINT, json=payload(item_id, area_id=dronero), headers=auth_headers(token))

    assert duplicate.status_code == 409
    assert duplicate.json()["detail"] == "Incrocio Infinity / Cliente-Fornitore gia esistente."


def test_stessa_area_immobili_diversi(client, db_session):
    token = make_admin_token(db_session)
    item_id = make_item(db_session)
    area_id = make_area(db_session, name="Dronero", area_code="DRO", buildings=["A1", "B2"])

    first = client.post(ENDPOINT, json=payload(item_id, area_id=area_id, buildings=["A1"]), headers=auth_headers(token))
    second = client.post(ENDPOINT, json=payload(item_id, area_id=area_id, buildings=["B2"]), headers=auth_headers(token))

    assert first.status_code == 201, first.text
    assert second.status_code == 201, second.text


def test_stessi_immobili_in_ordine_diverso_sono_lo_stesso_incrocio(client, db_session):
    token = make_admin_token(db_session)
    item_id = make_item(db_session)
    area_id = make_area(db_session, name="Dronero", area_code="DRO", buildings=["A1", "B2"])

    client.post(ENDPOINT, json=payload(item_id, area_id=area_id, buildings=["A1", "B2"]), headers=auth_headers(token))
    duplicate = client.post(
        ENDPOINT,
        json=payload(item_id, area_id=area_id, buildings=["B2", "A1"]),
        headers=auth_headers(token),
    )

    assert duplicate.status_code == 409


def test_update_che_sposta_sull_area_di_un_gemello(client, db_session):
    token = make_admin_token(db_session)
    item_id = make_item(db_session)
    dronero = make_area(db_session, name="Dronero", area_code="DRO")
    rossana = make_area(db_session, name="Rossana", area_code="ROS")

    client.post(ENDPOINT, json=payload(item_id, area_id=dronero), headers=auth_headers(token))
    second = client.post(ENDPOINT, json=payload(item_id, area_id=rossana), headers=auth_headers(token))
    map_id = second.json()["id"]

    moved = client.put(
        f"{ENDPOINT}/{map_id}",
        json={"operational_area_id": dronero},
        headers=auth_headers(token),
    )

    assert moved.status_code == 409

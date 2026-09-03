from app.models import LdapEmployee
from tests.conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def test_only_admin_can_manage_notification_rules(client, db_session):
    admin_headers = auth_headers(make_admin_token(db_session))
    employee = make_employee(db_session, tms_id="E1", full_name="Mario Rossi")
    user_headers = auth_headers(make_linked_user_token(db_session, employee, username="mario.rossi"))

    asset_class = client.post(
        "/api/maintenance/asset-classes",
        json={"code": "carrello_elevatore", "label": "Carrello elevatore"},
        headers=admin_headers,
    ).json()
    employee = LdapEmployee(username="notif.recipient", display_name="Notif Recipient", email="notif@example.com", is_active=True)
    db_session.add(employee)
    db_session.commit()

    denied = client.post(
        "/api/maintenance/notification-rules",
        json={"asset_class_id": asset_class["id"], "recipient_ldap_employee_ids": [employee.id]},
        headers=user_headers,
    )
    assert denied.status_code == 403

    created = client.post(
        "/api/maintenance/notification-rules",
        json={"asset_class_id": asset_class["id"], "site": "Saluzzo", "recipient_ldap_employee_ids": [employee.id]},
        headers=admin_headers,
    )
    assert created.status_code == 201
    rule = created.json()
    assert rule["asset_class_label"] == "Carrello elevatore"
    assert rule["recipient_labels"] == ["Notif Recipient"]
    assert rule["is_active"] is True

    updated = client.patch(
        f"/api/maintenance/notification-rules/{rule['id']}",
        json={"is_active": False},
        headers=admin_headers,
    )
    assert updated.status_code == 200
    assert updated.json()["is_active"] is False
    assert updated.json()["site"] == "Saluzzo"  # invariato: non era nel payload

    listed = client.get("/api/maintenance/notification-rules", headers=admin_headers).json()
    assert len(listed) == 1

    deleted = client.delete(f"/api/maintenance/notification-rules/{rule['id']}", headers=admin_headers)
    assert deleted.status_code == 204
    assert client.get("/api/maintenance/notification-rules", headers=admin_headers).json() == []

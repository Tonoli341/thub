from datetime import date, datetime, time, timezone

from app.enums import JustificationApprovalStatus, JustificationType
from app.models import DeviceAsset, DeviceDelivery, Justification
from tests.conftest import auth_headers, make_employee, make_linked_user_token


def test_notifications_aggregate_absence_approvals_and_device_signatures(client, db_session):
    approver = make_employee(db_session, tms_id="116", full_name="Responsabile Uno")
    requester = make_employee(
        db_session,
        tms_id="117",
        full_name="Collaboratore Uno",
        absence_approver_1_employee_id=approver.id,
    )
    justification = Justification(
        employee_id=requester.id,
        justification_type=JustificationType.ferie,
        start_date=date(2026, 8, 20),
        end_date=date(2026, 8, 22),
        start_time=time(8, 0),
        end_time=time(17, 0),
        approval_status=JustificationApprovalStatus.pending,
        approval_required=True,
        created_by_name=requester.full_name,
    )
    device = DeviceAsset(asset_type="notebook", brand="Dell", model="Latitude", is_active=True)
    db_session.add_all([justification, device])
    db_session.flush()
    delivery = DeviceDelivery(
        employee_id=approver.id,
        device_id=device.id,
        device_label="Dell Latitude",
        delivered_by="Ufficio IT",
        delivered_at=datetime(2026, 8, 18, 8, 0, tzinfo=timezone.utc),
        signature_requested_at=datetime(2026, 8, 18, 9, 0, tzinfo=timezone.utc),
    )
    db_session.add(delivery)
    db_session.commit()
    token = make_linked_user_token(db_session, approver, username="approver.notifications")

    unauthenticated = client.get("/api/notifications")
    response = client.get("/api/notifications", headers=auth_headers(token))

    assert unauthenticated.status_code == 401
    assert response.status_code == 200, response.text
    notifications = {item["category"]: item for item in response.json()}
    assert notifications["absence_approval"] == {
        "id": f"absence-approval:{justification.id}",
        "category": "absence_approval",
        "title": "Richiesta di ferie da approvare",
        "message": "Collaboratore Uno · 20/08/2026–22/08/2026",
        "detail": "Collaboratore Uno",
        "href": "/",
        "created_at": justification.created_at.isoformat().replace("+00:00", "Z"),
    }
    assert notifications["device_delivery_signature"]["id"] == (
        f"device-delivery-signature:{delivery.id}"
    )
    assert notifications["device_delivery_signature"]["href"] == (
        f"/le-mie-consegne/{delivery.id}/firma"
    )

    justification.approval_status = JustificationApprovalStatus.approved
    delivery.signature_b64 = "data:image/png;base64,firma"
    delivery.signed_at = datetime(2026, 8, 18, 9, 5, tzinfo=timezone.utc)
    db_session.commit()

    resolved = client.get("/api/notifications", headers=auth_headers(token))
    assert resolved.status_code == 200
    assert resolved.json() == []


def test_absence_notification_uses_current_manager_fallback(client, db_session):
    manager = make_employee(db_session, tms_id="200", full_name="Responsabile Corrente")
    requester = make_employee(
        db_session,
        tms_id="201",
        full_name="Collaboratore Due",
        manager_employee_id=manager.id,
    )
    db_session.add(Justification(
        employee_id=requester.id,
        justification_type=JustificationType.permesso,
        start_date=date(2026, 8, 21),
        end_date=date(2026, 8, 21),
        start_time=time(9, 0),
        end_time=time(11, 0),
        approval_status=JustificationApprovalStatus.pending,
        approval_required=True,
    ))
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.notifications.fallback")

    response = client.get("/api/notifications", headers=auth_headers(token))

    assert response.status_code == 200, response.text
    assert len(response.json()) == 1
    assert response.json()[0]["category"] == "absence_approval"
    assert response.json()[0]["title"] == "Richiesta di permesso da approvare"

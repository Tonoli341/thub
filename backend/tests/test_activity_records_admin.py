"""Test per la modifica/eliminazione admin delle giornate rendicontate."""

from datetime import datetime, timezone

from app.models import (
    ActiveActivity,
    ActivityRecord,
    InfinityBillingCustomerSupplierMap,
    InfinityBillingItem,
    OperationalArea,
)

from .conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def _make_record(db, employee) -> ActivityRecord:
    record = ActivityRecord(
        employee_id=employee.id,
        mapping_id="mapping-1",
        building="A",
        started_at=datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc),
        ended_at=datetime(2026, 7, 1, 12, 0, tzinfo=timezone.utc),
        duration_seconds=4 * 3600,
        field_values={},
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def test_admin_can_update_activity_record(client, db_session):
    employee = make_employee(db_session, tms_id="T1", full_name="Mario Rossi")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/activity-records/admin/{record.id}",
        headers=auth_headers(token),
        json={
            "started_at": "2026-07-01T09:00:00+00:00",
            "ended_at": "2026-07-01T14:00:00+00:00",
            "duration_seconds": 5 * 3600,
            "building": "B",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["duration_seconds"] == 5 * 3600
    assert body["building"] == "B"

    db_session.refresh(record)
    assert record.duration_seconds == 5 * 3600
    assert record.building == "B"


def test_update_rejects_end_before_start(client, db_session):
    employee = make_employee(db_session, tms_id="T2", full_name="Luigi Verdi")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/activity-records/admin/{record.id}",
        headers=auth_headers(token),
        json={
            "started_at": "2026-07-01T12:00:00+00:00",
            "ended_at": "2026-07-01T10:00:00+00:00",
        },
    )
    assert resp.status_code == 422


def test_non_admin_cannot_update_activity_record(client, db_session):
    employee = make_employee(db_session, tms_id="T3", full_name="Anna Bianchi")
    record = _make_record(db_session, employee)
    token = make_linked_user_token(db_session, employee, username="anna")

    resp = client.patch(
        f"/api/activity-records/admin/{record.id}",
        headers=auth_headers(token),
        json={"building": "Z"},
    )
    assert resp.status_code == 403

    db_session.refresh(record)
    assert record.building == "A"


def _make_active_activity(db, employee) -> ActiveActivity:
    activity = ActiveActivity(
        employee_id=employee.id,
        mapping_id="mapping-1",
        conflict_key="",
        started_at=datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc),
        last_heartbeat_at=datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc),
        field_values={},
    )
    db.add(activity)
    db.commit()
    db.refresh(activity)
    return activity


def test_non_admin_cannot_force_close_active_activity(client, db_session):
    employee = make_employee(db_session, tms_id="T4", full_name="Bruno Neri")
    activity = _make_active_activity(db_session, employee)
    token = make_linked_user_token(db_session, employee, username="bruno")

    resp = client.post(
        f"/api/activity-records/active/admin/{activity.id}/close",
        headers=auth_headers(token),
        json={},
    )
    assert resp.status_code == 403


def test_non_admin_cannot_discard_active_activity(client, db_session):
    employee = make_employee(db_session, tms_id="T5", full_name="Carlo Blu")
    activity = _make_active_activity(db_session, employee)
    token = make_linked_user_token(db_session, employee, username="carlo")

    resp = client.delete(
        f"/api/activity-records/active/admin/{activity.id}",
        headers=auth_headers(token),
    )
    assert resp.status_code == 403
    assert db_session.get(ActiveActivity, activity.id) is not None


def test_admin_can_discard_active_activity(client, db_session):
    employee = make_employee(db_session, tms_id="T6", full_name="Dina Verdi")
    activity = _make_active_activity(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.delete(
        f"/api/activity-records/active/admin/{activity.id}",
        headers=auth_headers(token),
    )
    assert resp.status_code == 204
    assert db_session.get(ActiveActivity, activity.id) is None


def test_active_activity_list_filters_by_start_date(client, db_session):
    employee = make_employee(db_session, tms_id="T8", full_name="Fabio Viola")
    db_session.add_all([
        ActiveActivity(
            employee_id=employee.id,
            mapping_id="mapping-old",
            conflict_key="",
            started_at=datetime(2026, 7, 15, 8, 0, tzinfo=timezone.utc),
            last_heartbeat_at=datetime(2026, 7, 15, 8, 0, tzinfo=timezone.utc),
            field_values={},
        ),
        ActiveActivity(
            employee_id=employee.id,
            mapping_id="mapping-new",
            conflict_key="",
            started_at=datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc),
            last_heartbeat_at=datetime(2026, 7, 16, 8, 0, tzinfo=timezone.utc),
            field_values={},
        ),
    ])
    db_session.commit()

    response = client.get(
        "/api/activity-records/active/admin?start_date=2026-07-16&end_date=2026-07-16",
        headers=auth_headers(make_admin_token(db_session)),
    )

    assert response.status_code == 200, response.text
    assert [row["mapping_id"] for row in response.json()] == ["mapping-new"]


def test_stats_include_area_building_customer_drilldown(client, db_session):
    employee = make_employee(db_session, tms_id="T7", full_name="Elena Gialli")
    area = OperationalArea(area_code="TEST", name="Area test", buildings=[])
    item = InfinityBillingItem(name="Voce test")
    db_session.add_all([area, item])
    db_session.flush()
    mapping = InfinityBillingCustomerSupplierMap(
        infinity_billing_item_id=item.id,
        customer_supplier_code="CLI-1",
        customer_supplier_description="Cliente test",
    )
    db_session.add(mapping)
    db_session.flush()
    db_session.add_all([
        ActivityRecord(
            employee_id=employee.id,
            mapping_id=mapping.id,
            operational_area_id=area.id,
            building="A1",
            started_at=datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc),
            ended_at=datetime(2026, 7, 1, 9, 0, tzinfo=timezone.utc),
            duration_seconds=3600,
            field_values={},
        ),
        ActivityRecord(
            employee_id=employee.id,
            mapping_id=mapping.id,
            operational_area_id=area.id,
            building="A1",
            started_at=datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),
            ended_at=datetime(2026, 7, 1, 10, 30, tzinfo=timezone.utc),
            duration_seconds=1800,
            field_values={},
        ),
    ])
    db_session.commit()

    response = client.get(
        "/api/activity-records/admin/stats?start_date=2026-07-01&end_date=2026-07-01",
        headers=auth_headers(make_admin_token(db_session)),
    )

    assert response.status_code == 200, response.text
    assert response.json()["by_location"] == [{
        "operational_area_id": area.id,
        "operational_area_name": "Area test",
        "building": "A1",
        "mapping_id": mapping.id,
        "customer_code": "CLI-1",
        "customer_name": "Cliente test",
        "activity_count": 2,
        "employee_count": 1,
        "total_seconds": 5400,
        "total_hours": 1.5,
    }]

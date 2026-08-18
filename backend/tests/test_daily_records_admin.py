"""Test per la modifica admin delle presenze registrate."""

from datetime import date, datetime, timezone

from app.models import DailyRecord

from .conftest import auth_headers, make_admin_token, make_employee, make_linked_user_token


def _make_record(db, employee) -> DailyRecord:
    record = DailyRecord(
        employee_id=employee.id,
        building="A",
        date=date(2026, 7, 1),
        started_at=datetime(2026, 7, 1, 8, 0, tzinfo=timezone.utc),
        ended_at=datetime(2026, 7, 1, 17, 0, tzinfo=timezone.utc),
        pauses=[{"started_at": "2026-07-01T12:00:00+00:00", "ended_at": "2026-07-01T13:00:00+00:00"}],
        pause_seconds=3600,
        work_seconds=8 * 3600,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record


def test_admin_can_update_daily_record(client, db_session):
    employee = make_employee(db_session, tms_id="D1", full_name="Mario Rossi")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={
            "started_at": "2026-07-01T09:00:00+00:00",
            "ended_at": "2026-07-01T17:00:00+00:00",
            "pause_seconds": 1800,
            "work_seconds": 7 * 3600 + 1800,
            "building": "B",
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["work_seconds"] == 7 * 3600 + 1800
    assert body["pause_seconds"] == 1800
    assert body["building"] == "B"

    db_session.refresh(record)
    assert record.work_seconds == 7 * 3600 + 1800
    assert record.building == "B"
    # Il log originale delle pause non viene toccato dalla modifica dei totali.
    assert len(record.pauses) == 1


def test_admin_can_edit_pause_intervals(client, db_session):
    """Le pause inviate sono la fonte di verità: i totali vengono ricalcolati."""
    employee = make_employee(db_session, tms_id="D4", full_name="Carla Neri")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={
            "pauses": [
                {"started_at": "2026-07-01T10:00:00+00:00", "ended_at": "2026-07-01T10:15:00+00:00"},
                {"started_at": "2026-07-01T12:00:00+00:00", "ended_at": "2026-07-01T12:30:00+00:00"},
            ],
        },
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert len(body["pauses"]) == 2
    # 15 + 30 min di pausa, su un lordo di 9h (08:00 → 17:00).
    assert body["pause_seconds"] == 45 * 60
    assert body["work_seconds"] == 9 * 3600 - 45 * 60


def test_update_rejects_overlapping_pauses(client, db_session):
    employee = make_employee(db_session, tms_id="D5", full_name="Dario Blu")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={
            "pauses": [
                {"started_at": "2026-07-01T10:00:00+00:00", "ended_at": "2026-07-01T11:00:00+00:00"},
                {"started_at": "2026-07-01T10:30:00+00:00", "ended_at": "2026-07-01T11:30:00+00:00"},
            ],
        },
    )
    assert resp.status_code == 422
    assert "sovrapporsi" in resp.json()["detail"]


def test_update_rejects_pause_outside_shift(client, db_session):
    employee = make_employee(db_session, tms_id="D6", full_name="Elena Gialli")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={"pauses": [{"started_at": "2026-07-01T06:00:00+00:00", "ended_at": "2026-07-01T07:00:00+00:00"}]},
    )
    assert resp.status_code == 422


def test_update_rejects_inverted_pause(client, db_session):
    employee = make_employee(db_session, tms_id="D7", full_name="Fabio Rosa")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={"pauses": [{"started_at": "2026-07-01T13:00:00+00:00", "ended_at": "2026-07-01T12:00:00+00:00"}]},
    )
    assert resp.status_code == 422


def test_clearing_pauses_zeroes_the_total(client, db_session):
    employee = make_employee(db_session, tms_id="D8", full_name="Gina Viola")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={"pauses": []},
    )

    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["pauses"] == []
    assert body["pause_seconds"] == 0
    assert body["work_seconds"] == 9 * 3600


def test_update_rejects_end_before_start(client, db_session):
    employee = make_employee(db_session, tms_id="D2", full_name="Luigi Verdi")
    record = _make_record(db_session, employee)
    token = make_admin_token(db_session)

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={
            "started_at": "2026-07-01T18:00:00+00:00",
            "ended_at": "2026-07-01T10:00:00+00:00",
        },
    )
    assert resp.status_code == 422


def test_non_admin_cannot_update_daily_record(client, db_session):
    employee = make_employee(db_session, tms_id="D3", full_name="Anna Bianchi")
    record = _make_record(db_session, employee)
    token = make_linked_user_token(db_session, employee, username="anna")

    resp = client.patch(
        f"/api/daily-records/admin/{record.id}",
        headers=auth_headers(token),
        json={"building": "Z"},
    )
    assert resp.status_code == 403

    db_session.refresh(record)
    assert record.building == "A"

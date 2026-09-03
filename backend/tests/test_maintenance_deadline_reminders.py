from datetime import date, datetime
from zoneinfo import ZoneInfo

from app.maintenance_asset_models import MaintenanceNotificationRule
from app.models import AuditLog, LdapEmployee
from app.services.maintenance_deadline_reminders import send_due_maintenance_deadline_emails
from tests.conftest import auth_headers, make_admin_token

TIMEZONE = ZoneInfo("Europe/Rome")


def _create_asset(client, headers, site=None, deadline_type_options=()):
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
    if deadline_type_options:
        client.patch(
            f"/api/maintenance/asset-types/{asset_type['id']}",
            json={"deadline_type_options": list(deadline_type_options)},
            headers=headers,
        )
    payload = {"asset_type_id": asset_type["id"], "custom_fields": {}}
    if site:
        payload["site"] = site
    asset = client.post("/api/maintenance/assets", json=payload, headers=headers).json()
    return asset, asset_class


def test_reminder_sent_once_a_day_only_with_matching_rule(client, db_session, monkeypatch):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset, asset_class = _create_asset(client, headers, site="Saluzzo", deadline_type_options=("verifica_forche",))

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "verifica_forche", "due_date": "2020-01-01"},
        headers=headers,
    ).json()

    employee = LdapEmployee(username="op.reminder", display_name="Op Reminder", email="op@example.com", is_active=True)
    db_session.add(employee)
    db_session.flush()
    db_session.add(
        MaintenanceNotificationRule(
            asset_class_id=asset_class["id"],
            site="Saluzzo",
            recipient_ldap_employee_ids=[employee.id],
            is_active=True,
        )
    )
    db_session.commit()

    sent_payloads = []

    def capture_email(email, recipient_name, deadlines):
        sent_payloads.append((email, recipient_name, deadlines))
        return True

    monkeypatch.setattr(
        "app.services.maintenance_deadline_reminders.send_maintenance_deadline_reminder",
        capture_email,
    )

    before_hour = send_due_maintenance_deadline_emails(db_session, datetime(2026, 8, 31, 7, 59, tzinfo=TIMEZONE))
    first_run = send_due_maintenance_deadline_emails(db_session, datetime(2026, 8, 31, 8, 0, tzinfo=TIMEZONE))
    repeated_run = send_due_maintenance_deadline_emails(db_session, datetime(2026, 8, 31, 9, 0, tzinfo=TIMEZONE))

    assert before_hour == 0
    assert first_run == 1
    assert repeated_run == 0
    assert len(sent_payloads) == 1
    email, recipient_name, deadlines = sent_payloads[0]
    assert email == "op@example.com"
    assert recipient_name == "Op Reminder"
    assert deadlines[0]["asset_internal_code"] == asset["internal_code"]
    assert deadlines[0]["urgency"] == "scaduta"

    from app.maintenance_asset_models import MaintenanceDeadline

    assert db_session.get(MaintenanceDeadline, deadline["id"]).last_notice_email_date == date(2026, 8, 31)
    assert db_session.query(AuditLog).filter_by(entity="maintenance_deadline", action="email_reminder_sent").count() == 1

    next_day_run = send_due_maintenance_deadline_emails(db_session, datetime(2026, 9, 1, 8, 0, tzinfo=TIMEZONE))
    assert next_day_run == 1


def test_no_email_without_matching_rule(client, db_session, monkeypatch):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset, _asset_class = _create_asset(client, headers, site="Fossano", deadline_type_options=("verifica_scaduta",))

    client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "verifica_scaduta", "due_date": "2020-01-01"},
        headers=headers,
    )

    sent_payloads = []
    monkeypatch.setattr(
        "app.services.maintenance_deadline_reminders.send_maintenance_deadline_reminder",
        lambda *args: sent_payloads.append(args) or True,
    )

    sent = send_due_maintenance_deadline_emails(db_session, datetime(2026, 8, 31, 8, 0, tzinfo=TIMEZONE))
    assert sent == 0
    assert sent_payloads == []


def test_failed_send_is_not_marked_as_sent(client, db_session, monkeypatch):
    token = make_admin_token(db_session)
    headers = auth_headers(token)
    asset, asset_class = _create_asset(client, headers, deadline_type_options=("verifica_scaduta",))

    deadline = client.post(
        f"/api/maintenance/assets/{asset['id']}/deadlines",
        json={"deadline_type": "verifica_scaduta", "due_date": "2020-01-01"},
        headers=headers,
    ).json()

    employee = LdapEmployee(username="op.fail", email="op-fail@example.com", is_active=True)
    db_session.add(employee)
    db_session.flush()
    db_session.add(
        MaintenanceNotificationRule(
            asset_class_id=asset_class["id"],
            recipient_ldap_employee_ids=[employee.id],
            is_active=True,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "app.services.maintenance_deadline_reminders.send_maintenance_deadline_reminder",
        lambda *args: False,
    )

    sent = send_due_maintenance_deadline_emails(db_session, datetime(2026, 8, 31, 8, 0, tzinfo=TIMEZONE))
    assert sent == 0

    from app.maintenance_asset_models import MaintenanceDeadline

    assert db_session.get(MaintenanceDeadline, deadline["id"]).last_notice_email_date is None

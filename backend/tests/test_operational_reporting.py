from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from sqlalchemy import create_engine, event, inspect, text

from app.enums import AssignmentCause, UserRole
from app.models import (
    Assignment,
    AuditLog,
    InfinityBillingCustomerSupplierMap,
    InfinityBillingItem,
    LdapEmployee,
    OperationalArea,
    Team,
    TeamMember,
)
from app.operational_reporting_models import (
    OperationalReportAllocation,
    OperationalReportBlock,
    OperationalReportDay,
)
from tests.conftest import auth_headers, engine, make_admin_token, make_employee, make_linked_user_token
from app.services.operational_reporting_schema import ensure_operational_reporting_schema
from app.services.operational_reporting import build_reporting_gap_notifications
from app.services.operational_reporting_reminders import send_due_operational_reporting_emails


DAY = date(2026, 8, 13)


def test_startup_schema_compatibility_adds_reporting_columns():
    legacy_engine = create_engine("sqlite://")
    with legacy_engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE operational_report_allocations ("
            "id VARCHAR(36) PRIMARY KEY, block_id VARCHAR(36), "
            "customer_code VARCHAR(64), customer_description_snapshot VARCHAR(160), "
            "minutes INTEGER, eligible_mapping_ids JSON)"
        ))

    ensure_operational_reporting_schema(legacy_engine)

    columns = {item["name"] for item in inspect(legacy_engine).get_columns("operational_report_allocations")}
    assert "jupiter_description_snapshot" in columns
    assert "sequence" in columns
    assert "start_offset_minutes" in columns
    assert "notes" in columns
    assert "actual_area_id" in columns
    assert "actual_area_name_snapshot" in columns
    assert "actual_building" in columns
    assert "created_by_name" in columns
    assert "created_at" in columns
    assert "last_modified_by_name" in columns
    assert "last_modified_at" in columns


def seed_reporting_day(db):
    manager = make_employee(
        db,
        tms_id="MGR-1",
        full_name="Manager Uno",
        config_can_access_timesheets=True,
    )
    worker = make_employee(
        db,
        tms_id="WRK-1",
        full_name="Operatore Uno",
        manager_employee_id=manager.id,
    )
    area = OperationalArea(
        area_code="AREA-A",
        name="Area A",
        is_active=True,
        is_operational=True,
        buildings=[{"code": "A1", "visible_in_planner": True, "visible_in_reporting": True}],
    )
    billing = InfinityBillingItem(name="Voce Infinity", is_active=True)
    db.add_all([area, billing])
    db.flush()
    mapping = InfinityBillingCustomerSupplierMap(
        infinity_billing_item_id=billing.id,
        customer_supplier_code="CLI-1",
        customer_supplier_description="Cliente Uno",
        jupiter_description="Attività Jupiter Uno",
        operational_area_id=area.id,
        buildings=["A1"],
        is_active=True,
    )
    team = Team(name="Squadra A", operational_reporting_owner_employee_id=manager.id)
    db.add_all([mapping, team])
    db.flush()
    db.add(TeamMember(team_id=team.id, employee_id=worker.id))
    assignment = Assignment(
        employee_id=worker.id,
        work_date=DAY,
        start_time=time(8, 0),
        end_time=time(17, 0),
        break_start=time(12, 0),
        break_end=time(13, 0),
        cause=AssignmentCause.presence,
        area="AREA-A",
        immobile="A1",
    )
    db.add(assignment)
    db.commit()
    return manager, worker, area, team, assignment, mapping


def test_operational_reporting_owner_can_match_team_leader(client, db_session):
    leader = make_employee(db_session, tms_id="OWNER-LEADER", full_name="Owner e Leader")
    team = Team(name="Squadra Owner Leader", team_leader_employee_id=leader.id)
    db_session.add(team)
    db_session.flush()
    db_session.add(TeamMember(team_id=team.id, employee_id=leader.id))
    db_session.commit()

    response = client.put(
        f"/api/teams/{team.id}",
        json={
            "operational_reporting_owner_employee_id": leader.id,
            "operational_reporting_email_enabled": True,
        },
        headers=auth_headers(make_admin_token(db_session)),
    )

    assert response.status_code == 200, response.text
    assert response.json()["operational_reporting_owner_employee_id"] == leader.id
    assert response.json()["operational_reporting_owner_employee_name"] == leader.full_name
    assert response.json()["operational_reporting_email_enabled"] is True
    assert response.json()["operational_reporting_notifications_enabled"] is False


def test_owner_notification_appears_after_ten_and_disappears_when_confirmed(
    client, db_session, monkeypatch
):
    manager, worker, _, team, _, _ = seed_reporting_day(db_session)
    team.operational_reporting_notifications_enabled = True
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.notifications")
    headers = auth_headers(token)
    timezone = ZoneInfo("Europe/Rome")

    monkeypatch.setattr(
        "app.services.operational_reporting.now_local",
        lambda: datetime(2026, 8, 14, 9, 59, tzinfo=timezone),
    )
    before_deadline = client.get("/api/operational-reporting/notifications", headers=headers)
    assert before_deadline.status_code == 200
    assert before_deadline.json() == []

    monkeypatch.setattr(
        "app.services.operational_reporting.now_local",
        lambda: datetime(2026, 8, 14, 10, 0, tzinfo=timezone),
    )
    after_deadline = client.get("/api/operational-reporting/notifications", headers=headers)
    assert after_deadline.status_code == 200, after_deadline.text
    assert after_deadline.json() == [{
        "id": f"operational-reporting:{DAY.isoformat()}:{team.id}",
        "title": "Rendicontazione da completare · Squadra A",
        "message": "Per il 13/08/2026 manca la conferma di 1 persona pianificata.",
        "work_date": DAY.isoformat(),
        "team_id": team.id,
        "team_name": team.name,
        "missing_count": 1,
        "missing_employee_ids": [worker.id],
        "missing_employee_names": [worker.full_name],
    }]

    db_session.add(OperationalReportDay(
        employee_id=worker.id,
        work_date=DAY,
        team_id=team.id,
        employee_name_snapshot=worker.full_name,
        team_name_snapshot=team.name,
        planned_start=time(8, 0),
        planned_end=time(17, 0),
        actual_start=time(8, 0),
        actual_end=time(17, 0),
        status="CONFIRMED",
    ))
    db_session.commit()

    completed = client.get("/api/operational-reporting/notifications", headers=headers)
    assert completed.status_code == 200
    assert completed.json() == []


def test_owner_notification_flags_confirmed_day_with_unallocated_time(
    client, db_session, monkeypatch
):
    manager, worker, area, team, _, mapping = seed_reporting_day(db_session)
    team.operational_reporting_notifications_enabled = True
    report = OperationalReportDay(
        employee_id=worker.id,
        work_date=DAY,
        team_id=team.id,
        employee_name_snapshot=worker.full_name,
        team_name_snapshot=team.name,
        planned_start=time(8, 0),
        planned_end=time(17, 0),
        actual_start=time(8, 0),
        actual_end=time(17, 0),
        pauses=[{"start": "12:00", "end": "13:00"}],
        status="CONFIRMED",
    )
    block = OperationalReportBlock(
        sequence=0,
        planned_start=time(8, 0),
        planned_end=time(17, 0),
        planned_break_minutes=60,
        actual_area_id=area.id,
        actual_area_name_snapshot=area.name,
        actual_building="A1",
    )
    # Giornata confermata con metà del tempo pianificato attribuito: 240 su 480.
    block.allocations.append(OperationalReportAllocation(
        customer_code=mapping.customer_supplier_code,
        customer_description_snapshot=mapping.customer_supplier_description,
        jupiter_description_snapshot=mapping.jupiter_description,
        sequence=0,
        minutes=240,
    ))
    report.blocks.append(block)
    db_session.add(report)
    db_session.commit()

    token = make_linked_user_token(db_session, manager, username="manager.partial")
    headers = auth_headers(token)
    monkeypatch.setattr(
        "app.services.operational_reporting.now_local",
        lambda: datetime(2026, 8, 14, 10, 0, tzinfo=ZoneInfo("Europe/Rome")),
    )

    partial = client.get("/api/operational-reporting/notifications", headers=headers)
    assert partial.status_code == 200, partial.text
    assert partial.json() == [{
        "id": f"operational-reporting:{DAY.isoformat()}:{team.id}",
        "title": "Rendicontazione da completare · Squadra A",
        "message": (
            "Per il 13/08/2026 1 rendicontazione confermata non copre "
            "tutto il tempo pianificato."
        ),
        "work_date": DAY.isoformat(),
        "team_id": team.id,
        "team_name": team.name,
        "missing_count": 1,
        "missing_employee_ids": [worker.id],
        "missing_employee_names": [worker.full_name],
    }]
    # L'email distingue la parziale indicando quanto resta da attribuire.
    assert build_reporting_gap_notifications(db_session, [team], DAY)[0][
        "missing_employee_labels"
    ] == [f"{worker.full_name} (4h da attribuire)"]

    block.allocations[0].minutes = 480
    db_session.commit()
    fully_allocated = client.get("/api/operational-reporting/notifications", headers=headers)
    assert fully_allocated.status_code == 200
    assert fully_allocated.json() == []


def test_owner_notification_requires_team_toggle_and_yesterday_planning(
    client, db_session, monkeypatch
):
    manager, _, _, team, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.notifications.disabled")
    headers = auth_headers(token)
    monkeypatch.setattr(
        "app.services.operational_reporting.now_local",
        lambda: datetime(2026, 8, 14, 10, 0, tzinfo=ZoneInfo("Europe/Rome")),
    )

    disabled = client.get("/api/operational-reporting/notifications", headers=headers)
    assert disabled.status_code == 200
    assert disabled.json() == []

    team.operational_reporting_notifications_enabled = True
    assignment.work_date = date(2026, 8, 12)
    db_session.commit()
    no_planning_yesterday = client.get("/api/operational-reporting/notifications", headers=headers)
    assert no_planning_yesterday.status_code == 200
    assert no_planning_yesterday.json() == []


def test_owner_email_reminder_is_independent_and_sent_once_after_ten(
    db_session, monkeypatch
):
    manager, worker, _, team, _, _ = seed_reporting_day(db_session)
    team.operational_reporting_notifications_enabled = False
    team.operational_reporting_email_enabled = True
    db_session.add(
        LdapEmployee(
            username="manager.email.reminder",
            display_name=manager.full_name,
            email="manager@example.com",
            tms_employee_id=manager.id,
            is_active=True,
        )
    )
    db_session.commit()
    timezone = ZoneInfo("Europe/Rome")
    sent_payloads = []

    def capture_email(email, owner_name, notifications):
        sent_payloads.append((email, owner_name, notifications))
        return True

    monkeypatch.setattr(
        "app.services.operational_reporting_reminders.send_operational_reporting_reminder",
        capture_email,
    )

    before_ten = send_due_operational_reporting_emails(
        db_session,
        datetime(2026, 8, 14, 9, 59, tzinfo=timezone),
    )
    first_run = send_due_operational_reporting_emails(
        db_session,
        datetime(2026, 8, 14, 10, 0, tzinfo=timezone),
    )
    repeated_run = send_due_operational_reporting_emails(
        db_session,
        datetime(2026, 8, 14, 10, 30, tzinfo=timezone),
    )

    assert before_ten == 0
    assert first_run == 1
    assert repeated_run == 0
    assert len(sent_payloads) == 1
    email, owner_name, notifications = sent_payloads[0]
    assert email == "manager@example.com"
    assert owner_name == manager.full_name
    assert notifications[0]["missing_employee_ids"] == [worker.id]
    assert db_session.get(Team, team.id).operational_reporting_last_email_date == DAY
    assert db_session.query(AuditLog).filter_by(
        entity="operational_reporting",
        action="email_reminder_sent",
    ).count() == 1


def test_failed_owner_email_reminder_is_not_marked_as_sent(db_session, monkeypatch):
    manager, _, _, team, _, _ = seed_reporting_day(db_session)
    team.operational_reporting_email_enabled = True
    db_session.add(
        LdapEmployee(
            username="manager.email.failure",
            email="manager-failure@example.com",
            tms_employee_id=manager.id,
            is_active=True,
        )
    )
    db_session.commit()
    monkeypatch.setattr(
        "app.services.operational_reporting_reminders.send_operational_reporting_reminder",
        lambda *_args: False,
    )

    sent = send_due_operational_reporting_emails(
        db_session,
        datetime(2026, 8, 14, 10, 0, tzinfo=ZoneInfo("Europe/Rome")),
    )

    assert sent == 0
    assert db_session.get(Team, team.id).operational_reporting_last_email_date is None


def test_manager_can_autosave_and_confirm_own_team(client, db_session):
    manager, worker, area, _, assignment, mapping = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.one")

    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))
    assert response.status_code == 200
    member = response.json()["teams"][0]["members"][0]
    assert member["has_planning"] is True
    assert member["blocks"][0]["eligible_customers"] == []
    customers = client.get(
        f"/api/operational-reporting/customers?area_id={area.id}&building=A1",
        headers=auth_headers(token),
    )
    assert customers.status_code == 200
    assert customers.json()[0]["code"] == "CLI-1"
    assert customers.json()[0]["jupiter_descriptions"] == [
        {"description": "Attività Jupiter Uno", "mapping_ids": [mapping.id]}
    ]

    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "notes": "Giornata regolare",
        "blocks": [
            {
                "source_assignment_id": assignment.id,
                "actual_area_id": area.id,
                "actual_building": "A1",
                "allocations": [
                    {
                        "customer_code": "CLI-1",
                        "jupiter_description": "Attività Jupiter Uno",
                        "minutes": 240,
                        "notes": "Nota del singolo box",
                    }
                ],
            }
        ],
    }
    saved = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert saved.status_code == 200, saved.text
    saved_body = saved.json()
    assert saved_body["status"] == "DRAFT"
    assert saved_body["allocated_minutes"] == 240
    assert saved_body["blocks"][0]["allocations"][0]["jupiter_description"] == "Attività Jupiter Uno"
    assert saved_body["blocks"][0]["allocations"][0]["notes"] == "Nota del singolo box"
    assert saved_body["blocks"][0]["allocations"][0]["eligible_mapping_ids"] == [mapping.id]

    # L'autosave invia più volte lo stesso oggetto: deve aggiornarlo in-place
    # senza violare il vincolo univoco cliente + descrizione Jupiter.
    payload["blocks"][0]["allocations"][0]["minutes"] = 230
    payload["blocks"][0]["allocations"][0]["notes"] = "Nota aggiornata"
    saved_again = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert saved_again.status_code == 200, saved_again.text
    assert saved_again.json()["allocated_minutes"] == 230
    assert saved_again.json()["blocks"][0]["allocations"][0]["minutes"] == 230
    assert saved_again.json()["blocks"][0]["allocations"][0]["notes"] == "Nota aggiornata"

    confirmed = client.post(
        f"/api/operational-reporting/{saved_body['report_id']}/confirm", headers=auth_headers(token)
    )
    assert confirmed.status_code == 200
    assert confirmed.json()["status"] == "CONFIRMED"
    assert db_session.query(AuditLog).filter(AuditLog.entity == "operational_report_day").count() == 3
    unchanged_assignment = db_session.get(Assignment, assignment.id)
    assert unchanged_assignment.start_time == time(8, 0)
    assert unchanged_assignment.end_time == time(17, 0)
    assert unchanged_assignment.area == "AREA-A"
    assert unchanged_assignment.immobile == "A1"


def test_allocation_tracks_author_and_only_stamps_real_changes(client, db_session):
    """Firma della casella con il metodo del Planner: nome dell'autore + istante."""

    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.one")
    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "blocks": [
            {
                "source_assignment_id": assignment.id,
                "actual_area_id": area.id,
                "actual_building": "A1",
                "allocations": [
                    {
                        "customer_code": "CLI-1",
                        "jupiter_description": "Attività Jupiter Uno",
                        "minutes": 240,
                    }
                ],
            }
        ],
    }

    created = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert created.status_code == 200, created.text
    first = created.json()["blocks"][0]["allocations"][0]
    assert first["created_by_name"] == "manager.one"
    assert first["last_modified_by_name"] == "manager.one"
    assert first["created_at"] is not None
    assert first["last_modified_at"] == first["created_at"]

    # L'autosave rimanda la stessa casella: senza modifiche reali la data non
    # deve muoversi, altrimenti smette di dire qualcosa.
    unchanged = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert unchanged.status_code == 200, unchanged.text
    same = unchanged.json()["blocks"][0]["allocations"][0]
    assert same["last_modified_at"] == first["last_modified_at"]

    payload["blocks"][0]["allocations"][0]["minutes"] = 230
    edited = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert edited.status_code == 200, edited.text
    changed = edited.json()["blocks"][0]["allocations"][0]
    assert changed["created_at"] == first["created_at"]
    assert changed["created_by_name"] == "manager.one"
    assert changed["last_modified_at"] > first["last_modified_at"]


def seed_second_area(db):
    """Seconda area raggiungibile a piedi dalla prima, con un cliente proprio."""
    area = OperationalArea(
        area_code="AREA-B",
        name="Area B",
        is_active=True,
        is_operational=True,
        buildings=[
            {"code": "B2", "visible_in_planner": True, "visible_in_reporting": True},
            {"code": "B9", "visible_in_planner": True, "visible_in_reporting": False},
        ],
    )
    billing = InfinityBillingItem(name="Voce Infinity B", is_active=True)
    db.add_all([area, billing])
    db.flush()
    mapping = InfinityBillingCustomerSupplierMap(
        infinity_billing_item_id=billing.id,
        customer_supplier_code="CLI-2",
        customer_supplier_description="Cliente Due",
        jupiter_description="Attività Jupiter Due",
        operational_area_id=area.id,
        buildings=["B2"],
        is_active=True,
    )
    db.add(mapping)
    db.commit()
    return area, mapping


def moving_payload(worker, assignment, area, second_area):
    """Mezza giornata in Area A, mezza in Area B, dentro lo stesso blocco."""
    return {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "blocks": [{
            "source_assignment_id": assignment.id,
            "actual_area_id": area.id,
            "actual_building": "A1",
            "allocations": [
                {
                    "customer_code": "CLI-1",
                    "jupiter_description": "Attività Jupiter Uno",
                    "start_offset_minutes": 0,
                    "minutes": 180,
                },
                {
                    "customer_code": "CLI-2",
                    "jupiter_description": "Attività Jupiter Due",
                    "actual_area_id": second_area.id,
                    "actual_building": "B2",
                    "start_offset_minutes": 240,
                    "minutes": 120,
                },
            ],
        }],
    }


def test_same_block_can_hold_different_actual_areas(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    second_area, second_mapping = seed_second_area(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.spostamento")

    saved = client.put(
        "/api/operational-reporting/day",
        json=moving_payload(worker, assignment, area, second_area),
        headers=auth_headers(token),
    )
    assert saved.status_code == 200, saved.text
    allocations = saved.json()["blocks"][0]["allocations"]
    assert saved.json()["allocated_minutes"] == 300
    # Il box senza indicazione resta dove sta il blocco.
    assert allocations[0]["actual_area_id"] == area.id
    assert allocations[0]["actual_area_name"] == "Area A"
    assert allocations[0]["actual_building"] == "A1"
    assert allocations[1]["actual_area_id"] == second_area.id
    assert allocations[1]["actual_area_name"] == "Area B"
    assert allocations[1]["actual_building"] == "B2"
    assert allocations[1]["eligible_mapping_ids"] == [second_mapping.id]
    # Il blocco conserva la destinazione pianificata anche se un box si sposta.
    assert saved.json()["blocks"][0]["actual_area_id"] == area.id
    assert saved.json()["blocks"][0]["actual_building"] == "A1"

    reread = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token)
    )
    assert reread.status_code == 200
    reread_allocations = reread.json()["teams"][0]["members"][0]["blocks"][0]["allocations"]
    assert [item["actual_area_id"] for item in reread_allocations] == [area.id, second_area.id]
    assert [item["actual_building"] for item in reread_allocations] == ["A1", "B2"]


def test_allocation_customer_is_validated_against_its_own_area(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    second_area, _ = seed_second_area(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.area.box")

    payload = moving_payload(worker, assignment, area, second_area)
    # Cliente dell'Area A dichiarato su un box che si trova in Area B.
    payload["blocks"][0]["allocations"][1]["customer_code"] = "CLI-1"
    payload["blocks"][0]["allocations"][1]["jupiter_description"] = "Attività Jupiter Uno"
    rejected = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "Il cliente CLI-1 non è valido per Area B / B2."


def test_allocation_building_must_be_visible_in_reporting(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    second_area, _ = seed_second_area(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.immobile.box")

    payload = moving_payload(worker, assignment, area, second_area)
    payload["blocks"][0]["allocations"][1]["actual_building"] = "B9"
    rejected = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert rejected.status_code == 422
    assert rejected.json()["detail"] == "Immobile non valido per l'area Area B."


def test_dashboard_groups_and_filters_locations_by_allocation(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    second_area, _ = seed_second_area(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.dashboard.aree")
    headers = auth_headers(token)
    saved = client.put(
        "/api/operational-reporting/day",
        json=moving_payload(worker, assignment, area, second_area),
        headers=headers,
    )
    assert saved.status_code == 200, saved.text

    period = f"start_date={DAY.isoformat()}&end_date={DAY.isoformat()}"
    dashboard = client.get(f"/api/operational-reporting/dashboard?{period}", headers=headers)
    assert dashboard.status_code == 200, dashboard.text
    locations = {(item["area_name"], item["building"]): item["minutes"] for item in dashboard.json()["locations"]}
    assert locations == {("Area A", "A1"): 180, ("Area B", "B2"): 120}

    filtered = client.get(
        f"/api/operational-reporting/dashboard?{period}&area_id={second_area.id}", headers=headers
    )
    assert filtered.status_code == 200, filtered.text
    assert filtered.json()["summary"]["allocated_minutes"] == 120
    assert [item["customer_code"] for item in filtered.json()["customers"]] == ["CLI-2"]


def test_infinity_mapping_update_propagates_and_delete_keeps_last_snapshot(client, db_session):
    manager, worker, area, _, assignment, mapping = seed_reporting_day(db_session)
    manager_token = make_linked_user_token(db_session, manager, username="manager.mapping.snapshot")
    manager_headers = auth_headers(manager_token)
    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "blocks": [{
            "source_assignment_id": assignment.id,
            "actual_area_id": area.id,
            "actual_building": "A1",
            "allocations": [{
                "customer_code": "CLI-1",
                "jupiter_description": "Attività Jupiter Uno",
                "minutes": 120,
            }],
        }],
    }
    saved = client.put("/api/operational-reporting/day", json=payload, headers=manager_headers)
    assert saved.status_code == 200, saved.text

    admin_headers = auth_headers(make_admin_token(db_session))
    updated = client.put(
        f"/api/infinity-billing-customer-supplier-map/{mapping.id}",
        json={"jupiter_description": "Attività Jupiter Rinominata"},
        headers=admin_headers,
    )
    assert updated.status_code == 200, updated.text

    history_after_update = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}",
        headers=manager_headers,
    )
    allocation = history_after_update.json()["teams"][0]["members"][0]["blocks"][0]["allocations"][0]
    assert allocation["jupiter_description"] == "Attività Jupiter Rinominata"

    deleted = client.delete(
        f"/api/infinity-billing-customer-supplier-map/{mapping.id}",
        headers=admin_headers,
    )
    assert deleted.status_code == 204, deleted.text

    history_after_delete = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}",
        headers=manager_headers,
    )
    deleted_allocation = history_after_delete.json()["teams"][0]["members"][0]["blocks"][0]["allocations"][0]
    assert deleted_allocation["jupiter_description"] == "Attività Jupiter Rinominata"


def test_operational_dashboard_aggregates_progress_hours_and_dimensions(client, db_session):
    manager, worker, area, team, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.dashboard")
    headers = auth_headers(token)
    query = f"start_date={DAY.isoformat()}&end_date={DAY.isoformat()}"

    initial = client.get(f"/api/operational-reporting/dashboard?{query}", headers=headers)
    assert initial.status_code == 200, initial.text
    assert initial.json()["summary"] == {
        "planned_days": 1,
        "reports": 0,
        "not_started": 1,
        "draft": 0,
        "confirmed": 0,
        "planned_minutes": 0,
        "work_minutes": 0,
        "variance_minutes": 0,
        "allocated_minutes": 0,
        "uncovered_minutes": 0,
        "overtime_minutes": 0,
        "coverage_percent": 0.0,
        "confirmation_percent": 0.0,
    }
    assert initial.json()["teams"][0]["members"][0]["employee_id"] == worker.id
    assert initial.json()["teams"][0]["members"][0]["not_started"] == 1
    assert initial.json()["workflow"] == {
        "expected_minutes": 480,
        "not_started_planned_minutes": 480,
        "saved_planned_minutes": 0,
        "draft_planned_minutes": 0,
        "confirmed_planned_minutes": 0,
        "saved_work_minutes": 0,
        "allocated_minutes": 0,
        "uncovered_minutes": 0,
        "variance_minutes": 0,
        "rows": [{
            "employee_id": worker.id,
            "employee_name": worker.full_name,
            "team_id": team.id,
            "team_name": team.name,
            "work_date": DAY.isoformat(),
            "status": "NOT_STARTED",
            "planned_minutes": 480,
            "work_minutes": 0,
            "allocated_minutes": 0,
            "uncovered_minutes": 0,
            "variance_minutes": 0,
        }],
    }

    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "blocks": [{
            "source_assignment_id": assignment.id,
            "actual_area_id": area.id,
            "actual_building": "A1",
            "allocations": [],
        }],
    }
    saved = client.put("/api/operational-reporting/day", json=payload, headers=headers)
    assert saved.status_code == 200, saved.text

    draft_dashboard = client.get(f"/api/operational-reporting/dashboard?{query}", headers=headers)
    assert draft_dashboard.status_code == 200, draft_dashboard.text
    draft_workflow = draft_dashboard.json()["workflow"]
    assert draft_workflow["not_started_planned_minutes"] == 0
    assert draft_workflow["draft_planned_minutes"] == 480
    assert draft_workflow["saved_work_minutes"] == 480
    assert draft_workflow["allocated_minutes"] == 0
    assert draft_workflow["uncovered_minutes"] == 480
    assert draft_workflow["rows"][0]["status"] == "DRAFT"

    payload["blocks"][0]["allocations"] = [{
        "customer_code": "CLI-1",
        "jupiter_description": "Attività Jupiter Uno",
        "start_offset_minutes": 0,
        "minutes": 480,
    }]
    saved = client.put("/api/operational-reporting/day", json=payload, headers=headers)
    assert saved.status_code == 200, saved.text
    confirmed = client.post(
        f"/api/operational-reporting/{saved.json()['report_id']}/confirm",
        headers=headers,
    )
    assert confirmed.status_code == 200, confirmed.text

    dashboard = client.get(
        f"/api/operational-reporting/dashboard?{query}&team_id={team.id}",
        headers=headers,
    )
    assert dashboard.status_code == 200, dashboard.text
    body = dashboard.json()
    assert body["summary"]["confirmed"] == 1
    assert body["summary"]["confirmation_percent"] == 100.0
    assert body["summary"]["work_minutes"] == 480
    assert body["summary"]["planned_minutes"] == 480
    assert body["summary"]["variance_minutes"] == 0
    assert body["summary"]["allocated_minutes"] == 480
    assert body["summary"]["coverage_percent"] == 100.0
    assert body["workflow"]["expected_minutes"] == 480
    assert body["workflow"]["not_started_planned_minutes"] == 0
    assert body["workflow"]["saved_planned_minutes"] == 480
    assert body["workflow"]["confirmed_planned_minutes"] == 480
    assert body["workflow"]["saved_work_minutes"] == 480
    assert body["workflow"]["allocated_minutes"] == 480
    assert body["workflow"]["uncovered_minutes"] == 0
    assert body["workflow"]["rows"][0]["status"] == "CONFIRMED"
    assert body["teams"][0]["confirmed"] == 1
    assert body["teams"][0]["members"][0]["confirmed"] == 1
    assert body["teams"][0]["members"][0]["coverage_percent"] == 100.0
    assert body["customers"][0]["customer_code"] == "CLI-1"
    assert body["customers"][0]["jupiter_description"] == "Attività Jupiter Uno"
    assert body["locations"][0]["area_id"] == area.id
    assert body["locations"][0]["building"] == "A1"

    filtered = client.get(
        "/api/operational-reporting/dashboard",
        params={
            "start_date": DAY.isoformat(),
            "end_date": DAY.isoformat(),
            "customer_code": "CLI-1",
            "area_id": area.id,
            "building": "a1",
        },
        headers=headers,
    )
    assert filtered.status_code == 200, filtered.text
    filtered_body = filtered.json()
    assert filtered_body["summary"]["reports"] == 1
    assert filtered_body["summary"]["allocated_minutes"] == 480
    assert filtered_body["filters"]["building"] == "A1"
    assert filtered_body["teams"][0]["members"][0]["employee_id"] == worker.id

    no_matches = client.get(
        "/api/operational-reporting/dashboard",
        params={"start_date": DAY.isoformat(), "end_date": DAY.isoformat(), "customer_code": "INESISTENTE"},
        headers=headers,
    )
    assert no_matches.status_code == 200, no_matches.text
    assert no_matches.json()["summary"]["reports"] == 0
    assert no_matches.json()["teams"] == []
    assert no_matches.json()["customers"] == []


def test_manager_without_permission_is_denied(client, db_session):
    manager, *_ = seed_reporting_day(db_session)
    manager.config_can_access_timesheets = False
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.denied")
    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))
    assert response.status_code == 403


def test_same_customer_can_use_multiple_jupiter_descriptions(client, db_session):
    manager, worker, area, _, assignment, first_mapping = seed_reporting_day(db_session)
    second_mapping = InfinityBillingCustomerSupplierMap(
        infinity_billing_item_id=first_mapping.infinity_billing_item_id,
        customer_supplier_code="CLI-1",
        customer_supplier_description="Cliente Uno",
        jupiter_description="Attività Jupiter Due",
        operational_area_id=area.id,
        buildings=["A1"],
        is_active=True,
    )
    db_session.add(second_mapping)
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.jupiter.multi")

    customers = client.get(
        f"/api/operational-reporting/customers?area_id={area.id}&building=A1",
        headers=auth_headers(token),
    )
    assert customers.status_code == 200
    assert [item["description"] for item in customers.json()[0]["jupiter_descriptions"]] == [
        "Attività Jupiter Due",
        "Attività Jupiter Uno",
    ]

    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "blocks": [
            {
                "source_assignment_id": assignment.id,
                "actual_area_id": area.id,
                "actual_building": "A1",
                "allocations": [
                    {
                        "customer_code": "CLI-1",
                        "jupiter_description": "Attività Jupiter Uno",
                        "start_offset_minutes": 0,
                        "minutes": 100,
                    },
                    {
                        "customer_code": "CLI-1",
                        "jupiter_description": "Attività Jupiter Due",
                        # 300 minuti netti dall'inizio: dopo la pausa 12–13,
                        # lasciando anche uno spazio vuoto tra i due box.
                        "start_offset_minutes": 300,
                        "minutes": 100,
                    },
                ],
            }
        ],
    }
    saved = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert saved.status_code == 200, saved.text
    allocations = saved.json()["blocks"][0]["allocations"]
    assert {(item["customer_code"], item["jupiter_description"]) for item in allocations} == {
        ("CLI-1", "Attività Jupiter Uno"),
        ("CLI-1", "Attività Jupiter Due"),
    }
    assert [item["start_offset_minutes"] for item in allocations] == [0, 300]

    payload["blocks"][0]["allocations"].reverse()
    reordered = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert reordered.status_code == 200, reordered.text
    reordered_allocations = reordered.json()["blocks"][0]["allocations"]
    assert [item["jupiter_description"] for item in reordered_allocations] == [
        "Attività Jupiter Due",
        "Attività Jupiter Uno",
    ]
    assert [item["sequence"] for item in reordered_allocations] == [0, 1]
    assert [item["start_offset_minutes"] for item in reordered_allocations] == [300, 0]


def test_admin_sees_team_without_operational_reporting_owner(client, db_session):
    _, worker, _, team, *_ = seed_reporting_day(db_session)
    team.operational_reporting_owner_employee_id = None
    db_session.commit()
    response = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}",
        headers=auth_headers(make_admin_token(db_session)),
    )
    assert response.status_code == 200
    assert response.json()["teams"][0]["members"][0]["employee_id"] == worker.id


def test_linked_legacy_admin_without_timesheet_permission_is_denied(client, db_session):
    manager = make_employee(
        db_session,
        tms_id="LEGACY-ADMIN",
        full_name="Manager Storico",
        app_role=None,
        config_can_access_timesheets=False,
    )
    make_employee(
        db_session,
        tms_id="LEGACY-REPORT",
        full_name="Riporto Storico",
        manager_employee_id=manager.id,
    )
    token = make_linked_user_token(
        db_session,
        manager,
        username="legacy-reporting-admin",
        role=UserRole.admin,
    )

    response = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}",
        headers=auth_headers(token),
    )
    assert response.status_code == 403


def test_manager_only_sees_team_when_directly_configured_as_reporting_owner(client, db_session):
    top_manager = make_employee(
        db_session,
        tms_id="TOP-1",
        full_name="Responsabile Superiore",
        config_can_access_timesheets=True,
    )
    intermediate = make_employee(
        db_session,
        tms_id="MID-1",
        full_name="Responsabile Intermedio",
        manager_employee_id=top_manager.id,
        config_can_access_timesheets=True,
    )
    worker = make_employee(
        db_session,
        tms_id="IND-1",
        full_name="Riporto Indiretto",
        manager_employee_id=intermediate.id,
    )
    team = Team(name="Squadra Indiretta", operational_reporting_owner_employee_id=intermediate.id)
    db_session.add(team)
    db_session.flush()
    db_session.add(TeamMember(team_id=team.id, employee_id=worker.id))
    db_session.add(
        Assignment(
            employee_id=worker.id,
            work_date=DAY,
            start_time=time(8, 0),
            end_time=time(17, 0),
            cause=AssignmentCause.presence,
        )
    )
    db_session.commit()
    top_token = make_linked_user_token(db_session, top_manager, username="manager.top")

    top_response = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}",
        headers=auth_headers(top_token),
    )
    assert top_response.status_code == 200
    assert top_response.json()["teams"] == []

    owner_token = make_linked_user_token(db_session, intermediate, username="manager.owner")
    owner_response = client.get(
        f"/api/operational-reporting/day?day={DAY.isoformat()}",
        headers=auth_headers(owner_token),
    )
    assert owner_response.status_code == 200
    assert owner_response.json()["teams"][0]["team_id"] == team.id


def test_overallocation_is_rejected(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.over")
    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "10:00",
        "pauses": [],
        "blocks": [
            {
                "source_assignment_id": assignment.id,
                "actual_area_id": area.id,
                "actual_building": "A1",
                "allocations": [
                    {
                        "customer_code": "CLI-1",
                        "jupiter_description": "Attività Jupiter Uno",
                        "minutes": 130,
                    }
                ],
            }
        ],
    }
    response = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert response.status_code == 422


def test_reporting_can_extend_beyond_planner_hours(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.extended")
    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "07:00",
        "actual_end": "18:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "blocks": [{
            "source_assignment_id": assignment.id,
            "actual_area_id": area.id,
            "actual_building": "A1",
            "allocations": [
                {
                    "customer_code": "CLI-1",
                    "jupiter_description": "Attività Jupiter Uno",
                    "start_offset_minutes": 0,
                    "minutes": 300,
                },
                {
                    "customer_code": "CLI-1",
                    "jupiter_description": "Attività Jupiter Uno",
                    "start_offset_minutes": 300,
                    "minutes": 300,
                },
            ],
        }],
    }

    response = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["pauses"] == [{"start": "12:00:00", "end": "13:00:00"}]
    assert body["work_minutes"] == 600
    assert body["blocks"][0]["reporting_start"] == "07:00:00"
    assert body["blocks"][0]["reporting_end"] == "18:00:00"
    assert body["blocks"][0]["capacity_minutes"] == 600
    assert len(body["blocks"][0]["allocations"]) == 2
    repeated_payload = {
        **payload,
        "blocks": [{
            **payload["blocks"][0],
            "allocations": [
                {
                    **source,
                    "id": saved_allocation["id"],
                }
                for source, saved_allocation in zip(
                    payload["blocks"][0]["allocations"],
                    body["blocks"][0]["allocations"],
                )
            ],
        }],
    }
    repeated = client.put("/api/operational-reporting/day", json=repeated_payload, headers=auth_headers(token))
    assert repeated.status_code == 200, repeated.text
    assert len(repeated.json()["blocks"][0]["allocations"]) == 2
    crossing_payload = {
        **payload,
        "blocks": [{
            **payload["blocks"][0],
            "allocations": [{
                "customer_code": "CLI-1",
                "jupiter_description": "Attività Jupiter Uno",
                "start_offset_minutes": 0,
                "minutes": 310,
            }],
        }],
    }
    crossing = client.put("/api/operational-reporting/day", json=crossing_payload, headers=auth_headers(token))
    assert crossing.status_code == 200, crossing.text
    assert crossing.json()["blocks"][0]["allocations"][0]["minutes"] == 310

    # Un solo box può coprire tutto il tempo netto 07:00–18:00, inglobando
    # visivamente la pausa 12:00–13:00 senza trasformarla in tempo allocato.
    crossing_payload["blocks"][0]["allocations"][0]["minutes"] = 600
    full_day = client.put("/api/operational-reporting/day", json=crossing_payload, headers=auth_headers(token))
    assert full_day.status_code == 200, full_day.text
    assert full_day.json()["blocks"][0]["allocations"][0]["minutes"] == 600
    unchanged_assignment = db_session.get(Assignment, assignment.id)
    assert unchanged_assignment.start_time == time(8, 0)
    assert unchanged_assignment.end_time == time(17, 0)


def test_reset_from_planner_removes_report_and_returns_clean_sheet(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    second_worker = make_employee(
        db_session,
        tms_id="WRK-RESET-2",
        full_name="Operatore Due",
        manager_employee_id=manager.id,
    )
    second_team = Team(name="Squadra B", operational_reporting_owner_employee_id=manager.id)
    db_session.add(second_team)
    db_session.flush()
    db_session.add(TeamMember(team_id=second_team.id, employee_id=second_worker.id))
    second_assignment = Assignment(
        employee_id=second_worker.id,
        work_date=DAY,
        start_time=time(9, 0),
        end_time=time(17, 0),
        cause=AssignmentCause.presence,
        area="AREA-A",
        immobile="A1",
    )
    db_session.add(second_assignment)
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.reset")
    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "07:00",
        "actual_end": "18:00",
        "pauses": [],
        "notes": "Da azzerare",
        "blocks": [{
            "source_assignment_id": assignment.id,
            "actual_area_id": area.id,
            "actual_building": "A1",
            "allocations": [{
                "customer_code": "CLI-1",
                "jupiter_description": "Attività Jupiter Uno",
                "minutes": 120,
            }],
        }],
    }
    saved = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert saved.status_code == 200, saved.text
    second_payload = {
        **payload,
        "employee_id": second_worker.id,
        "blocks": [{
            **payload["blocks"][0],
            "source_assignment_id": second_assignment.id,
        }],
    }
    second_saved = client.put("/api/operational-reporting/day", json=second_payload, headers=auth_headers(token))
    assert second_saved.status_code == 200, second_saved.text

    reset = client.post(
        f"/api/operational-reporting/day/reset?day={DAY.isoformat()}",
        headers=auth_headers(token),
    )

    assert reset.status_code == 200, reset.text
    members = {
        member["employee_id"]: member
        for team in reset.json()["teams"]
        for member in team["members"]
    }
    clean = members[worker.id]
    assert clean["report_id"] is None
    assert clean["status"] is None
    assert clean["actual_start"] == "08:00:00"
    assert clean["actual_end"] == "17:00:00"
    assert clean["pauses"] == [{"start": "12:00:00", "end": "13:00:00"}]
    assert clean["notes"] is None
    assert clean["blocks"][0]["allocations"] == []
    assert members[second_worker.id]["report_id"] is None
    assert members[second_worker.id]["blocks"][0]["allocations"] == []
    assert db_session.query(OperationalReportDay).filter_by(work_date=DAY).count() == 0
    reset_logs = db_session.query(AuditLog).filter(
        AuditLog.entity == "operational_report_day",
        AuditLog.action == "reset_from_planner",
    ).all()
    assert len(reset_logs) == 2
    unchanged_assignment = db_session.get(Assignment, assignment.id)
    assert unchanged_assignment.start_time == time(8, 0)
    assert unchanged_assignment.end_time == time(17, 0)
    unchanged_second_assignment = db_session.get(Assignment, second_assignment.id)
    assert unchanged_second_assignment.start_time == time(9, 0)
    assert unchanged_second_assignment.end_time == time(17, 0)


def test_reset_member_removes_selected_employee_report(client, db_session):
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.restore.member")
    payload = {
        "employee_id": worker.id,
        "work_date": DAY.isoformat(),
        "actual_start": "08:00",
        "actual_end": "17:00",
        "pauses": [{"start": "12:00", "end": "13:00"}],
        "notes": "Modifica autosalvata",
        "blocks": [{
            "source_assignment_id": assignment.id,
            "actual_area_id": area.id,
            "actual_building": "A1",
            "allocations": [{
                "customer_code": "CLI-1",
                "jupiter_description": "Attività Jupiter Uno",
                "minutes": 120,
            }],
        }],
    }
    saved = client.put("/api/operational-reporting/day", json=payload, headers=auth_headers(token))
    assert saved.status_code == 200, saved.text

    restored = client.post(
        "/api/operational-reporting/day/reset-member",
        params={"day": DAY.isoformat(), "employee_id": worker.id},
        headers=auth_headers(token),
    )

    assert restored.status_code == 200, restored.text
    body = restored.json()
    assert body["employee_id"] == worker.id
    assert body["report_id"] is None
    assert body["status"] is None
    assert body["notes"] is None
    assert body["blocks"][0]["allocations"] == []
    assert db_session.query(OperationalReportDay).filter_by(employee_id=worker.id, work_date=DAY).count() == 0
    assert db_session.query(AuditLog).filter_by(
        entity="operational_report_day",
        action="restore_from_planner",
    ).count() == 1


def test_day_query_count_does_not_grow_with_planned_blocks(client, db_session):
    manager, _, _, team, template, _ = seed_reporting_day(db_session)
    for index in range(2, 12):
        worker = make_employee(
            db_session,
            tms_id=f"PERF-{index}",
            full_name=f"Operatore Performance {index}",
            manager_employee_id=manager.id,
        )
        db_session.add(TeamMember(team_id=team.id, employee_id=worker.id))
        db_session.add(
            Assignment(
                employee_id=worker.id,
                work_date=DAY,
                start_time=time(8, 0),
                end_time=time(17, 0),
                cause=AssignmentCause.presence,
                area=template.area,
                immobile=template.immobile,
            )
        )
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.performance")

    query_count = 0

    def count_query(*_args, **_kwargs):
        nonlocal query_count
        query_count += 1

    event.listen(engine, "before_cursor_execute", count_query)
    try:
        response = client.get(
            f"/api/operational-reporting/day?day={DAY.isoformat()}",
            headers=auth_headers(token),
        )
    finally:
        event.remove(engine, "before_cursor_execute", count_query)

    assert response.status_code == 200
    assert len(response.json()["teams"][0]["members"]) == 11
    assert query_count <= 8


def _schedule(break_minutes=60, break_start=None, break_end=None):
    # DAY è un giovedì: indice 3 nella settimana lunedì-domenica del Planner.
    day = {
        "enabled": True,
        "start": "08:00",
        "end": "17:00",
        "break_minutes": break_minutes,
        "break_start": break_start,
        "break_end": break_end,
    }
    return [day] * 7


def test_pause_is_inherited_from_default_schedule(client, db_session):
    """Il Planner disegna la pausa dell'orario di default anche quando
    l'assegnazione non ne porta una: la rendicontazione deve ricopiarla."""
    manager, worker, _, _, assignment, _ = seed_reporting_day(db_session)
    assignment.break_start = None
    assignment.break_end = None
    worker.default_schedule = _schedule()
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.schedule")

    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))

    assert response.status_code == 200, response.text
    member = response.json()["teams"][0]["members"][0]
    # 08:00-17:00 con 60' di pausa: netto 480', pausa centrata alle 12:00.
    assert member["pauses"] == [{"start": "12:00:00", "end": "13:00:00"}]
    assert member["work_minutes"] == 480
    assert member["blocks"][0]["capacity_minutes"] == 480
    assert member["blocks"][0]["planned_break_minutes"] == 60


def test_explicit_schedule_pause_wins_over_centered_default(client, db_session):
    manager, worker, _, _, assignment, _ = seed_reporting_day(db_session)
    assignment.break_start = None
    assignment.break_end = None
    worker.default_schedule = _schedule(break_start="12:30", break_end="13:30")
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.schedule.explicit")

    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))

    assert response.status_code == 200, response.text
    assert response.json()["teams"][0]["members"][0]["pauses"] == [{"start": "12:30:00", "end": "13:30:00"}]


def test_schedule_pause_outside_the_planned_block_is_ignored(client, db_session):
    """Turno spezzato 08-12 / 13-17: la pausa dell'orario cade nel buco fra i
    blocchi, quindi il Planner non la disegna e nemmeno la rendicontazione."""
    manager, worker, _, _, assignment, _ = seed_reporting_day(db_session)
    assignment.end_time = time(12, 0)
    assignment.break_start = None
    assignment.break_end = None
    worker.default_schedule = _schedule()
    db_session.add(
        Assignment(
            employee_id=worker.id,
            work_date=DAY,
            start_time=time(13, 0),
            end_time=time(17, 0),
            cause=AssignmentCause.presence,
            area="AREA-A",
            immobile="A1",
        )
    )
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.split")

    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))

    assert response.status_code == 200, response.text
    member = response.json()["teams"][0]["members"][0]
    assert member["pauses"] == []
    assert [block["capacity_minutes"] for block in member["blocks"]] == [240, 240]
    assert member["work_minutes"] == 540


def test_assignment_break_overrides_schedule_pause(client, db_session):
    manager, worker, _, _, _, _ = seed_reporting_day(db_session)
    worker.default_schedule = _schedule()
    db_session.commit()
    token = make_linked_user_token(db_session, manager, username="manager.assignment.break")

    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))

    assert response.status_code == 200, response.text
    # La pausa esplicita sull'assegnazione resta 12:00-13:00, non duplicata.
    assert response.json()["teams"][0]["members"][0]["pauses"] == [{"start": "12:00:00", "end": "13:00:00"}]


def test_inconsistent_stored_pauses_do_not_break_the_grid(client, db_session):
    """Una pausa storica che sborda dalla giornata non deve far fallire la GET."""
    manager, worker, area, _, assignment, _ = seed_reporting_day(db_session)
    token = make_linked_user_token(db_session, manager, username="manager.legacy")
    saved = client.put(
        "/api/operational-reporting/day",
        json={
            "employee_id": worker.id,
            "work_date": DAY.isoformat(),
            "actual_start": "08:00",
            "actual_end": "17:00",
            "pauses": [{"start": "12:00", "end": "13:00"}],
            "blocks": [{"source_assignment_id": assignment.id, "actual_area_id": area.id, "actual_building": "A1", "allocations": []}],
        },
        headers=auth_headers(token),
    )
    assert saved.status_code == 200, saved.text
    report = db_session.get(OperationalReportDay, saved.json()["report_id"])
    report.pauses = [{"start": "07:00", "end": "13:00"}]
    db_session.commit()

    response = client.get(f"/api/operational-reporting/day?day={DAY.isoformat()}", headers=auth_headers(token))

    assert response.status_code == 200, response.text
    member = response.json()["teams"][0]["members"][0]
    # La sovrapposizione viene tagliata sulla giornata: 09:00 di lordo - 5h.
    assert member["work_minutes"] == 240

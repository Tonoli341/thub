from datetime import date, time

from sqlalchemy import create_engine, event, inspect, text

from app.enums import AssignmentCause, UserRole
from app.models import (
    Assignment,
    AuditLog,
    InfinityBillingCustomerSupplierMap,
    InfinityBillingItem,
    OperationalArea,
    Team,
    TeamMember,
)
from app.operational_reporting_models import OperationalReportDay
from tests.conftest import auth_headers, engine, make_admin_token, make_employee, make_linked_user_token
from app.services.operational_reporting_schema import ensure_operational_reporting_schema


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
        json={"operational_reporting_owner_employee_id": leader.id},
        headers=auth_headers(make_admin_token(db_session)),
    )

    assert response.status_code == 200, response.text
    assert response.json()["operational_reporting_owner_employee_id"] == leader.id
    assert response.json()["operational_reporting_owner_employee_name"] == leader.full_name


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

from datetime import date, time

from sqlalchemy import select

from app.enums import JustificationApprovalStatus, JustificationType
from app.models import Assignment, Employee, Justification, OrgDepartment, OrgFunction, Team, TeamMember
from app.services.tms import TmsEmployeeRecord, sync_employees


def test_sync_deactivation_removes_employee_from_teams_and_org_but_keeps_history(db_session, monkeypatch):
    inactive_employee = Employee(
        tms_id="100",
        full_name="Mario Rossi",
        manager_name="Old Manager",
        organization_function="Logistica",
        organization_department="Magazzino",
        is_active=True,
    )
    active_employee = Employee(
        tms_id="200",
        full_name="Luigi Bianchi",
        manager_employee_id=None,
        manager_name="Mario Rossi",
        is_active=True,
    )
    db_session.add_all([inactive_employee, active_employee])
    db_session.flush()

    active_employee.manager_employee_id = inactive_employee.id

    db_session.add(
        Team(
            name="Squadra A",
            team_leader_employee_id=inactive_employee.id,
            team_leader_2_employee_id=inactive_employee.id,
            reports_to_employee_id=inactive_employee.id,
        )
    )
    db_session.flush()
    team = db_session.scalar(select(Team).where(Team.name == "Squadra A"))
    db_session.add(TeamMember(team_id=team.id, employee_id=inactive_employee.id))

    db_session.add(OrgFunction(name="Logistica", responsible_employee_id=inactive_employee.id, is_active=True))
    db_session.add(OrgDepartment(name="Magazzino", responsible_employee_id=inactive_employee.id, is_active=True))

    db_session.add(
        Assignment(
            employee_id=inactive_employee.id,
            work_date=date(2026, 7, 1),
            start_time=time(8, 0),
            end_time=time(17, 0),
            site="Sede",
            area="Area 1",
        )
    )
    db_session.add(
        Justification(
            employee_id=inactive_employee.id,
            justification_type=JustificationType.ferie,
            start_date=date(2026, 7, 2),
            end_date=date(2026, 7, 2),
            start_time=time(8, 0),
            end_time=time(17, 0),
            approval_status=JustificationApprovalStatus.approved,
            approval_required=False,
        )
    )
    db_session.commit()

    monkeypatch.setattr(
        "app.services.tms.fetch_employees_from_tms",
        lambda: [
            TmsEmployeeRecord(
                tms_id="200",
                full_name="Luigi Bianchi",
                phone=None,
                tms_role_code=None,
                tms_role_description="ALTRO",
                contract_type=None,
                datore_lavoro=None,
                birth_date=None,
                photo_jpeg=None,
            )
        ],
    )

    result = sync_employees(db_session)

    assert result.deactivated == 1

    db_session.expire_all()

    inactive_employee = db_session.scalar(select(Employee).where(Employee.tms_id == "100"))
    active_employee = db_session.scalar(select(Employee).where(Employee.tms_id == "200"))
    team = db_session.scalar(select(Team).where(Team.name == "Squadra A"))
    org_function = db_session.scalar(select(OrgFunction).where(OrgFunction.name == "Logistica"))
    org_department = db_session.scalar(select(OrgDepartment).where(OrgDepartment.name == "Magazzino"))

    assert inactive_employee is not None
    assert inactive_employee.is_active is False
    assert db_session.scalar(select(TeamMember).where(TeamMember.employee_id == inactive_employee.id)) is None
    assert team is not None
    assert team.team_leader_employee_id is None
    assert team.team_leader_2_employee_id is None
    assert team.reports_to_employee_id is None
    assert org_function is not None
    assert org_function.responsible_employee_id is None
    assert org_department is not None
    assert org_department.responsible_employee_id is None
    assert active_employee is not None
    assert active_employee.manager_employee_id is None
    assert active_employee.manager_name is None

    assert db_session.scalar(select(Assignment).where(Assignment.employee_id == inactive_employee.id)) is not None
    assert db_session.scalar(select(Justification).where(Justification.employee_id == inactive_employee.id)) is not None

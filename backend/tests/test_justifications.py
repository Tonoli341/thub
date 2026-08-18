from datetime import date, time

from app.enums import JustificationApprovalStatus, JustificationType
from app.models import Justification
from app.services.security import create_email_approval_token
from tests.conftest import auth_headers, make_employee, make_admin_token


def _payload(employee_id: str, start: str = "2026-08-10", end: str = "2026-08-14") -> dict:
    return {
        "employee_id": employee_id,
        "justification_type": "FERIE",
        "start_date": start,
        "end_date": end,
        "start_time": "08:00:00",
        "end_time": "17:00:00",
    }


def _make_justification(db, employee, *, status: JustificationApprovalStatus, approver=None) -> Justification:
    justification = Justification(
        employee_id=employee.id,
        justification_type=JustificationType.ferie,
        start_date=date(2026, 8, 10),
        end_date=date(2026, 8, 14),
        start_time=time(8, 0),
        end_time=time(17, 0),
        approval_status=status,
        approval_required=status == JustificationApprovalStatus.pending,
        approver_1_employee_id=approver.id if approver else None,
    )
    db.add(justification)
    db.commit()
    return justification


def test_overlap_with_pending_request_is_rejected(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    _make_justification(db_session, employee, status=JustificationApprovalStatus.pending)
    token = make_admin_token(db_session)

    response = client.post("/api/justifications", json=_payload(employee.id), headers=auth_headers(token))
    assert response.status_code == 409


def test_rejected_request_does_not_block_resubmission(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    _make_justification(db_session, employee, status=JustificationApprovalStatus.rejected)
    token = make_admin_token(db_session)

    response = client.post("/api/justifications", json=_payload(employee.id), headers=auth_headers(token))
    assert response.status_code == 201


def test_email_approval_get_has_no_side_effects(client, db_session):
    approver = make_employee(db_session, tms_id="85", full_name="Capo Reparto")
    employee = make_employee(
        db_session,
        tms_id="100",
        full_name="Mario Rossi",
        absence_approver_1_employee_id=approver.id,
    )
    justification = _make_justification(
        db_session, employee, status=JustificationApprovalStatus.pending, approver=approver
    )
    token = create_email_approval_token(
        justification_id=justification.id, approver_employee_id=approver.id
    )

    response = client.get(f"/api/email-approvals/{token}?action=approved")
    assert response.status_code == 200

    db_session.refresh(justification)
    assert justification.approval_status == JustificationApprovalStatus.pending


def test_email_approval_post_applies_action(client, db_session):
    approver = make_employee(db_session, tms_id="85", full_name="Capo Reparto")
    employee = make_employee(
        db_session,
        tms_id="100",
        full_name="Mario Rossi",
        absence_approver_1_employee_id=approver.id,
    )
    justification = _make_justification(
        db_session, employee, status=JustificationApprovalStatus.pending, approver=approver
    )
    token = create_email_approval_token(
        justification_id=justification.id, approver_employee_id=approver.id
    )

    response = client.post(
        f"/api/email-approvals/{token}",
        data={"approval_status": "approved"},
    )
    assert response.status_code == 200

    db_session.refresh(justification)
    assert justification.approval_status == JustificationApprovalStatus.approved


def test_created_by_is_recorded_on_creation(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    token = make_admin_token(db_session)

    response = client.post("/api/justifications", json=_payload(employee.id), headers=auth_headers(token))
    assert response.status_code == 201
    body = response.json()
    assert body["created_by_name"] == "Sys Admin"
    assert body["decided_by_name"] is None


def test_decided_by_is_recorded_on_email_approval(client, db_session):
    approver = make_employee(db_session, tms_id="85", full_name="Capo Reparto")
    employee = make_employee(
        db_session,
        tms_id="100",
        full_name="Mario Rossi",
        absence_approver_1_employee_id=approver.id,
    )
    justification = _make_justification(
        db_session, employee, status=JustificationApprovalStatus.pending, approver=approver
    )
    token = create_email_approval_token(
        justification_id=justification.id, approver_employee_id=approver.id
    )

    response = client.post(f"/api/email-approvals/{token}", data={"approval_status": "approved"})
    assert response.status_code == 200

    db_session.refresh(justification)
    assert justification.decided_by_name == "Capo Reparto"
    assert justification.decided_at is not None


def test_decided_by_is_recorded_on_portal_approval(client, db_session):
    employee = make_employee(db_session, tms_id="100", full_name="Mario Rossi")
    justification = _make_justification(db_session, employee, status=JustificationApprovalStatus.pending)
    token = make_admin_token(db_session)

    response = client.patch(
        f"/api/justifications/{justification.id}/approval",
        json={"approval_status": "rejected"},
        headers=auth_headers(token),
    )
    assert response.status_code == 200
    body = response.json()
    assert body["decided_by_name"] == "sysadmin"
    assert body["decided_at"] is not None

    back_to_pending = client.patch(
        f"/api/justifications/{justification.id}/approval",
        json={"approval_status": "pending"},
        headers=auth_headers(token),
    )
    assert back_to_pending.status_code == 200
    assert back_to_pending.json()["decided_by_name"] is None

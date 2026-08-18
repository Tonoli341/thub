from html import escape

from fastapi import APIRouter, Depends, Form, HTTPException, Query, status
from fastapi.responses import HTMLResponse
from sqlalchemy.orm import Session

from app.api.justifications import get_justification_or_404
from app.db import get_db
from app.enums import JustificationApprovalStatus
from app.models import Employee
from app.services.justification_approval import apply_justification_approval_update, employee_can_approve_justification
from app.services.security import decode_email_approval_token

router = APIRouter(prefix="/email-approvals", tags=["email-approvals"])

_STATUS_LABELS = {
    JustificationApprovalStatus.pending: "In attesa",
    JustificationApprovalStatus.approved: "Approvata",
    JustificationApprovalStatus.rejected: "Rifiutata",
}
_ACTION_LABELS = {
    JustificationApprovalStatus.approved: "Accetta",
    JustificationApprovalStatus.rejected: "Rifiuta",
}


def _normalize_action(value: str | None) -> JustificationApprovalStatus | None:
    if value not in {JustificationApprovalStatus.approved.value, JustificationApprovalStatus.rejected.value}:
        return None
    return JustificationApprovalStatus(value)


def _render_page(
    *,
    title: str,
    message: str,
    status_code: int = status.HTTP_200_OK,
    employee_name: str = "",
    type_label: str = "",
    period_label: str = "",
    description: str = "",
    current_status_label: str = "",
    token: str | None = None,
    suggested_action: JustificationApprovalStatus | None = None,
    can_submit: bool = False,
) -> HTMLResponse:
    approve_active = "active" if suggested_action == JustificationApprovalStatus.approved else ""
    reject_active = "active reject" if suggested_action == JustificationApprovalStatus.rejected else "reject"
    details_html = ""
    if employee_name:
        details_html = f"""
        <div class="card">
          <div class="grid">
            <div class="label">Dipendente</div><div>{escape(employee_name)}</div>
            <div class="label">Richiesta</div><div>{escape(type_label)}</div>
            <div class="label">Periodo</div><div>{escape(period_label)}</div>
            <div class="label">Stato attuale</div><div>{escape(current_status_label)}</div>
            {f'<div class="label">Note</div><div>{escape(description)}</div>' if description else ''}
          </div>
        </div>
        """
    actions_html = ""
    if can_submit and token:
        actions_html = f"""
        <form method="post" class="actions">
          <button type="submit" name="approval_status" value="{JustificationApprovalStatus.approved.value}" class="btn {approve_active}">Accetta</button>
          <button type="submit" name="approval_status" value="{JustificationApprovalStatus.rejected.value}" class="btn {reject_active}">Rifiuta</button>
        </form>
        <p class="hint">Il click aggiorna la richiesta senza richiedere login al portale.</p>
        """
    html = f"""<!DOCTYPE html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{escape(title)}</title>
  <style>
    body {{ margin: 0; background: #f4f4f0; font-family: Arial, Helvetica, sans-serif; color: #202020; }}
    .wrap {{ max-width: 720px; margin: 0 auto; padding: 32px 16px; }}
    .hero {{ background: #007040; color: #fff; border-radius: 14px 14px 0 0; padding: 20px 24px; font-weight: 700; }}
    .panel {{ background: #fff; border: 1px solid #e8e8e4; border-top: 0; border-radius: 0 0 14px 14px; padding: 24px; }}
    .lead {{ font-size: 16px; line-height: 1.5; margin: 0 0 18px; }}
    .card {{ background: #f8f8f6; border-left: 4px solid #007040; border-radius: 10px; padding: 18px; margin: 0 0 20px; }}
    .grid {{ display: grid; grid-template-columns: 150px 1fr; gap: 10px 12px; font-size: 14px; line-height: 1.4; }}
    .label {{ color: #6c757d; font-weight: 700; }}
    .actions {{ display: flex; gap: 12px; flex-wrap: wrap; margin-top: 22px; }}
    .btn {{ border: 0; border-radius: 10px; padding: 12px 18px; font-size: 15px; font-weight: 700; cursor: pointer; background: #e6f4ee; color: #007040; }}
    .btn.reject {{ background: #fceeed; color: #a12622; }}
    .btn.active {{ box-shadow: inset 0 0 0 2px rgba(0, 112, 64, 0.25); }}
    .btn.reject.active {{ box-shadow: inset 0 0 0 2px rgba(161, 38, 34, 0.2); }}
    .hint {{ color: #6c757d; font-size: 13px; margin: 14px 0 0; }}
    @media (max-width: 640px) {{
      .grid {{ grid-template-columns: 1fr; }}
      .actions {{ flex-direction: column; }}
      .btn {{ width: 100%; }}
    }}
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">T-Hub Workforce Planner</div>
    <div class="panel">
      <p class="lead"><strong>{escape(title)}</strong></p>
      <p class="lead">{escape(message)}</p>
      {details_html}
      {actions_html}
    </div>
  </div>
</body>
</html>"""
    return HTMLResponse(content=html, status_code=status_code)


def _resolve_request_from_token(db: Session, token: str) -> tuple[Employee | None, object]:
    payload = decode_email_approval_token(token)
    justification = get_justification_or_404(db, str(payload["justification_id"]))
    approver = db.get(Employee, str(payload["approver_employee_id"]))
    return approver, justification


@router.get("/{token}", response_class=HTMLResponse)
def review_email_approval(
    token: str,
    action: str | None = Query(default=None),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    try:
        approver, justification = _resolve_request_from_token(db, token)
    except HTTPException as exc:
        return _render_page(
            title="Link non valido",
            message=exc.detail if isinstance(exc.detail, str) else "Il link non e piu valido.",
            status_code=exc.status_code,
        )

    suggested_action = _normalize_action(action)
    period = (
        justification.start_date.strftime("%d/%m/%Y")
        if justification.start_date == justification.end_date
        else f"{justification.start_date.strftime('%d/%m/%Y')} - {justification.end_date.strftime('%d/%m/%Y')}"
    )

    if not employee_can_approve_justification(db, approver, justification):
        return _render_page(
            title="Autorizzazione non disponibile",
            message="Questo link non e piu autorizzato per la richiesta corrente.",
            status_code=status.HTTP_403_FORBIDDEN,
            employee_name=justification.employee.full_name,
            type_label=justification.justification_type.value.title(),
            period_label=period,
            description=justification.description or "",
            current_status_label=_STATUS_LABELS[justification.approval_status],
        )

    if justification.approval_status != JustificationApprovalStatus.pending:
        return _render_page(
            title="Richiesta gia gestita",
            message="La richiesta e gia stata gestita e questo link non puo piu modificarla.",
            employee_name=justification.employee.full_name,
            type_label=justification.justification_type.value.title(),
            period_label=period,
            description=justification.description or "",
            current_status_label=_STATUS_LABELS[justification.approval_status],
        )

    # L'azione viene applicata SOLO sulla POST del form: una GET non deve avere
    # effetti collaterali, altrimenti antivirus e prefetch dei client di posta
    # possono approvare/rifiutare la richiesta al posto dell'approvatore.
    return _render_page(
        title="Gestisci richiesta di assenza",
        message="Conferma l'azione con i pulsanti qui sotto.",
        employee_name=justification.employee.full_name,
        type_label=justification.justification_type.value.title(),
        period_label=period,
        description=justification.description or "",
        current_status_label=_STATUS_LABELS[justification.approval_status],
        token=token,
        suggested_action=suggested_action,
        can_submit=True,
    )


@router.post("/{token}", response_class=HTMLResponse)
def submit_email_approval(
    token: str,
    approval_status: JustificationApprovalStatus = Form(...),
    db: Session = Depends(get_db),
) -> HTMLResponse:
    try:
        approver, justification = _resolve_request_from_token(db, token)
    except HTTPException as exc:
        return _render_page(
            title="Link non valido",
            message=exc.detail if isinstance(exc.detail, str) else "Il link non e piu valido.",
            status_code=exc.status_code,
        )

    period = (
        justification.start_date.strftime("%d/%m/%Y")
        if justification.start_date == justification.end_date
        else f"{justification.start_date.strftime('%d/%m/%Y')} - {justification.end_date.strftime('%d/%m/%Y')}"
    )

    if approval_status not in {JustificationApprovalStatus.approved, JustificationApprovalStatus.rejected}:
        return _render_page(
            title="Azione non valida",
            message="Sono consentite solo le azioni Accetta o Rifiuta.",
            status_code=status.HTTP_400_BAD_REQUEST,
        )

    if not employee_can_approve_justification(db, approver, justification):
        return _render_page(
            title="Autorizzazione non disponibile",
            message="Questo link non e piu autorizzato per la richiesta corrente.",
            status_code=status.HTTP_403_FORBIDDEN,
            employee_name=justification.employee.full_name,
            type_label=justification.justification_type.value.title(),
            period_label=period,
            description=justification.description or "",
            current_status_label=_STATUS_LABELS[justification.approval_status],
        )

    if justification.approval_status != JustificationApprovalStatus.pending:
        return _render_page(
            title="Richiesta gia gestita",
            message="La richiesta e gia stata gestita e questo link non puo piu modificarla.",
            employee_name=justification.employee.full_name,
            type_label=justification.justification_type.value.title(),
            period_label=period,
            description=justification.description or "",
            current_status_label=_STATUS_LABELS[justification.approval_status],
        )

    approver_name = approver.full_name if approver else "Approvatore email"
    apply_justification_approval_update(
        db,
        justification,
        approval_status,
        audit_actor_name=f"email-link:{approver_name}",
        approver_name=approver_name,
        approver_employee_id=approver.id if approver else None,
    )
    return _render_page(
        title=f"Richiesta {_ACTION_LABELS[approval_status].lower()}ta",
        message=f"La richiesta e stata {_STATUS_LABELS[approval_status].lower()} con successo.",
        employee_name=justification.employee.full_name,
        type_label=justification.justification_type.value.title(),
        period_label=period,
        description=justification.description or "",
        current_status_label=_STATUS_LABELS[justification.approval_status],
    )

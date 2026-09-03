import logging
import smtplib
import threading
from datetime import date
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from html import escape

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.models import DeviceDelivery, Justification, LdapEmployee
from app.services.security import create_email_approval_token

logger = logging.getLogger(__name__)

_TYPE_LABELS = {"FERIE": "Ferie", "PERMESSO": "Permesso", "ALTRO": "Assenza"}
_TYPE_COLORS = {"FERIE": "#007040", "PERMESSO": "#d97706", "ALTRO": "#6c757d"}
_STATUS_LABELS = {"approved": "Approvata", "rejected": "Rifiutata", "pending": "In attesa"}
_STATUS_COLORS = {"approved": "#4f772d", "rejected": "#bc4749", "pending": "#d97706"}
_STATUS_BG = {"approved": "#f0f7ec", "rejected": "#fdf0f0", "pending": "#fef9ec"}


def get_employee_email(db: Session, employee_id: str) -> str | None:
    ldap_emp = db.scalar(select(LdapEmployee).where(LdapEmployee.tms_employee_id == employee_id))
    return ldap_emp.email if ldap_emp and ldap_emp.email else None


def _logo_html() -> str:
    """Logo T-Hub in HTML puro, compatibile con Outlook."""
    return """
    <table cellpadding="0" cellspacing="0" border="0" style="display:inline-table;">
      <tr>
        <td style="vertical-align:middle; padding-right:10px;">
          <!--[if !mso]><!-->
          <div style="width:36px;height:36px;background:#F0ECE0;border-radius:10px;position:relative;overflow:hidden;display:inline-block;vertical-align:middle;">
            <div style="position:absolute;top:50%;left:50%;width:22px;height:22px;background:#007040;transform:translate(-50%,-50%);border-radius:50%;overflow:hidden;">
              <div style="position:absolute;top:4px;left:0;width:22px;height:6px;background:#F0ECE0;"></div>
              <div style="position:absolute;top:4px;left:8px;width:6px;height:18px;background:#F0ECE0;"></div>
            </div>
          </div>
          <!--<![endif]-->
        </td>
        <td style="vertical-align:middle;">
          <span style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:18px;font-weight:700;color:#ffffff;letter-spacing:-0.3px;">T-Hub</span>
        </td>
      </tr>
    </table>"""


def _wrap_html(title: str, body_html: str, preview_text: str = "") -> str:
    """Template HTML email completo con branding T-Hub."""
    logo = _logo_html()
    return f"""<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta http-equiv="X-UA-Compatible" content="IE=edge">
<title>{title}</title>
<link href="https://fonts.googleapis.com/css2?family=Lexend:wght@400;600;700;800&amp;display=swap" rel="stylesheet" type="text/css">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Lexend:wght@400;600;700;800&display=swap');
  body, table, td {{ margin:0; padding:0; border:0; font-family:'Lexend',Arial,Helvetica,sans-serif; }}
  body {{ background:#f4f4f0; }}
  a {{ color:#007040; text-decoration:none; }}
</style>
<!--[if mso]>
<style type="text/css">
  body, table, td, span, p, a {{ font-family:Arial,Helvetica,sans-serif !important; }}
</style>
<![endif]-->
</head>
<body style="background:#f4f4f0; margin:0; padding:0;">
{"<span style='display:none;max-height:0;overflow:hidden;color:#f4f4f0;'>" + preview_text + "</span>" if preview_text else ""}
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f0;">
  <tr>
    <td align="center" style="padding:32px 16px 24px;">

      <!-- Card -->
      <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

        <!-- Header -->
        <tr>
          <td style="background:#007040;border-radius:12px 12px 0 0;padding:20px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td>{logo}</td>
                <td align="right" style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:11px;color:rgba(255,255,255,0.65);letter-spacing:0.05em;text-transform:uppercase;">Workforce Planner</td>
              </tr>
            </table>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="background:#ffffff;padding:32px 32px 28px;border-left:1px solid #e8e8e4;border-right:1px solid #e8e8e4;">
            {body_html}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#F0ECE0;border-radius:0 0 12px 12px;padding:16px 32px;border:1px solid #e0dcd4;border-top:none;">
            <table width="100%" cellpadding="0" cellspacing="0" border="0">
              <tr>
                <td style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:11px;color:#2B2B2B;opacity:0.55;">
                  Tonoli S.p.A. · T-Hub Workforce Planner<br>
                  Questo messaggio è generato automaticamente, non rispondere a questa email.
                </td>
                <td align="right">
                  <div style="width:24px;height:24px;background:#2B2B2B;border-radius:6px;display:inline-block;overflow:hidden;position:relative;">
                    <div style="position:absolute;top:50%;left:50%;width:14px;height:14px;background:#007040;transform:translate(-50%,-50%);border-radius:50%;overflow:hidden;">
                      <div style="position:absolute;top:2.5px;left:0;width:14px;height:4px;background:#F0ECE0;"></div>
                      <div style="position:absolute;top:2.5px;left:5px;width:4px;height:11.5px;background:#F0ECE0;"></div>
                    </div>
                  </div>
                </td>
              </tr>
            </table>
          </td>
        </tr>

      </table>
    </td>
  </tr>
</table>
</body>
</html>"""


def _info_row(label: str, value: str) -> str:
    return f"""
    <tr>
      <td style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:13px;color:#6c757d;padding:6px 0 0;width:130px;vertical-align:top;">{label}</td>
      <td style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:13px;color:#2B2B2B;font-weight:600;padding:6px 0 0;vertical-align:top;">{value}</td>
    </tr>"""


def _fmt(d: date) -> str:
    return d.strftime("%d/%m/%Y")


_FULL_DAY_START = "08:00"
_FULL_DAY_END = "18:00"
# 08:00-17:00 e' il marcatore storico della giornata intera: resta riconosciuto
# perche' e' quello salvato sulle assenze gia' a DB e sui client esterni.
_FULL_DAY_RANGES = {(_FULL_DAY_START, _FULL_DAY_END), (_FULL_DAY_START, "17:00")}


def _format_period(justification: Justification) -> str:
    """Periodo della richiesta: se riguarda esclusivamente ore di assenza (stesso
    giorno, orario diverso dalla giornata lavorativa standard) mostra il totale ore
    richieste invece della data, coerentemente con la dashboard."""
    start, end = _fmt(justification.start_date), _fmt(justification.end_date)
    if justification.start_date == justification.end_date:
        s = str(justification.start_time)[:5]
        e = str(justification.end_time)[:5]
        if (s, e) not in _FULL_DAY_RANGES:
            sh, sm = (int(x) for x in s.split(":"))
            eh, em = (int(x) for x in e.split(":"))
            hours = (eh * 60 + em - (sh * 60 + sm)) / 60
            if hours > 0:
                return f"{hours:.1f}h"
    return start if start == end else f"{start} – {end}"


def _format_day_time(justification: Justification) -> str:
    """Giorno (o intervallo di giorni) e fascia oraria richiesti, sempre esplicitati
    a differenza di _format_period che per le assenze a ore mostra solo il totale."""
    start, end = _fmt(justification.start_date), _fmt(justification.end_date)
    day = start if start == end else f"{start} – {end}"
    s = str(justification.start_time)[:5]
    e = str(justification.end_time)[:5]
    return f"{day} · {s}–{e}"


def _build_email_approval_url(token: str, action: str) -> str:
    return f"{settings.public_api_base_url.rstrip('/')}/email-approvals/{token}?action={action}"


def _send(to: list[str], subject: str, text: str, html: str) -> None:
    """Prepara il messaggio e lo consegna in un thread separato: l'invio SMTP
    (timeout 10s per destinatario) non deve bloccare la richiesta HTTP."""
    if not settings.smtp_enabled or not settings.smtp_host:
        logger.debug("SMTP non configurato, email saltata: %s", subject)
        return
    to = [addr for addr in to if addr]
    if not to:
        return
    threading.Thread(target=_send_sync, args=(to, subject, text, html), daemon=True).start()


def _send_sync(to: list[str], subject: str, text: str, html: str) -> bool:
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.smtp_from or settings.smtp_user
        msg["To"] = ", ".join(to)
        msg.attach(MIMEText(text, "plain", "utf-8"))
        msg.attach(MIMEText(html, "html", "utf-8"))
        smtp_host = settings.smtp_host.strip()
        with smtplib.SMTP(smtp_host, settings.smtp_port, timeout=10) as server:
            if settings.smtp_port == 587:
                server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.sendmail(msg["From"], to, msg.as_string())
        logger.info("Email inviata a %s: %s", to, subject)
        return True
    except Exception:
        logger.exception("Errore invio email a %s", to)
        return False


def notify_approvers_new_request(db: Session, justification: Justification) -> None:
    """Notifica gli approvatori di una nuova richiesta di assenza."""
    if not justification.approval_required:
        return

    employee_name = justification.employee.full_name
    jtype = justification.justification_type.value
    type_label = _TYPE_LABELS.get(jtype, "Assenza")
    type_color = _TYPE_COLORS.get(jtype, "#6c757d")
    period = _format_day_time(justification)

    approver_ids = [
        justification.approver_1_employee_id,
        justification.approver_2_employee_id,
        justification.approver_3_employee_id,
    ]
    recipient_links: list[tuple[str, str, str]] = []
    seen_emails: set[str] = set()
    for approver_id in approver_ids:
        if not approver_id:
            continue
        email = get_employee_email(db, approver_id)
        if not email or email in seen_emails:
            continue
        seen_emails.add(email)
        token = create_email_approval_token(justification_id=justification.id, approver_employee_id=approver_id)
        recipient_links.append(
            (
                email,
                _build_email_approval_url(token, "approved"),
                _build_email_approval_url(token, "rejected"),
            )
        )
    if not recipient_links:
        return

    subject = f"Nuova richiesta di {type_label.lower()} — {employee_name}"
    for email, approve_url, reject_url in recipient_links:
        text = (
            f"Hai una nuova richiesta di {type_label.lower()} da approvare.\n\n"
            f"Dipendente: {employee_name}\n"
            f"Tipo: {type_label}\n"
            f"Periodo: {period}\n\n"
            f"Accetta: {approve_url}\n"
            f"Rifiuta: {reject_url}\n\n"
            f"— T-Hub Workforce Planner · Tonoli S.p.A."
        )

        body_html = f"""
        <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#2B2B2B;margin:0 0 6px;">
          Nuova richiesta di {type_label.lower()}
        </p>
        <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;color:#555;margin:0 0 24px;line-height:1.5;">
          Hai ricevuto una richiesta di assenza che richiede la tua approvazione.
        </p>

        <!-- Info card -->
        <table width="100%" cellpadding="0" cellspacing="0" border="0"
               style="background:#f8f8f6;border-radius:8px;border-left:4px solid {type_color};padding:4px 0;">
          <tr><td style="padding:16px 20px;">
            <table cellpadding="0" cellspacing="0" border="0" width="100%">
              {_info_row("Dipendente", employee_name)}
              {_info_row("Tipo richiesta", f'<span style="display:inline-block;padding:2px 8px;background:{type_color}1a;color:{type_color};border-radius:4px;font-size:12px;font-weight:700;">{type_label}</span>')}
              {_info_row("Periodo", period)}
            </table>
          </td></tr>
        </table>

        <table cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">
          <tr>
            <td style="padding-right:10px;">
              <a href="{approve_url}" style="display:inline-block;background:#007040;color:#ffffff;font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;text-decoration:none;">Accetta</a>
            </td>
            <td>
              <a href="{reject_url}" style="display:inline-block;background:#bc4749;color:#ffffff;font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;text-decoration:none;">Rifiuta</a>
            </td>
          </tr>
        </table>

        <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:13px;color:#6c757d;margin:16px 0 0;line-height:1.5;">
          Il link apre una pagina di conferma con l'azione già selezionata: basta un click per confermare, senza entrare nel portale.
        </p>
        """
        _send([email], subject, text, _wrap_html(subject, body_html, f"Richiesta di {type_label.lower()} da {employee_name} · {period}"))


def notify_employee_approval_update(db: Session, justification: Justification, approver_name: str) -> None:
    """Notifica il dipendente (e il richiedente se diverso) dell'aggiornamento di stato."""
    employee_email = get_employee_email(db, justification.employee_id)
    requester_email = None
    if (
        justification.requested_by_employee_id
        and justification.requested_by_employee_id != justification.employee_id
    ):
        requester_email = get_employee_email(db, justification.requested_by_employee_id)

    emails = list({e for e in [employee_email, requester_email] if e})
    if not emails:
        return

    jtype = justification.justification_type.value
    type_label = _TYPE_LABELS.get(jtype, "Assenza")
    type_color = _TYPE_COLORS.get(jtype, "#6c757d")
    status = justification.approval_status.value
    status_label = _STATUS_LABELS.get(status, status)
    status_color = _STATUS_COLORS.get(status, "#6c757d")
    status_bg = _STATUS_BG.get(status, "#f8f8f8")
    period = _format_period(justification)
    employee_name = justification.employee.full_name

    subject = f"Richiesta di {type_label.lower()} {status_label.lower()} — {employee_name}"

    text = (
        f"La richiesta di {type_label.lower()} per {employee_name} ({period}) "
        f"è stata {status_label.lower()} da {approver_name}.\n\n"
        f"— T-Hub Workforce Planner · Tonoli S.p.A."
    )

    body_html = f"""
    <!-- Status banner -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:{status_bg};border-radius:8px;border:1px solid {status_color}33;margin-bottom:24px;">
      <tr><td style="padding:14px 20px;">
        <table cellpadding="0" cellspacing="0" border="0">
          <tr>
            <td style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:20px;font-weight:800;color:{status_color};padding-right:12px;">
              {"✓" if status == "approved" else "✕"}
            </td>
            <td>
              <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:{status_color};margin:0;">
                Richiesta {status_label.lower()}
              </p>
              <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:12px;color:{status_color};opacity:0.8;margin:2px 0 0;">
                gestita da {approver_name}
              </p>
            </td>
          </tr>
        </table>
      </td></tr>
    </table>

    <!-- Info card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f8f8f6;border-radius:8px;border-left:4px solid {type_color};">
      <tr><td style="padding:16px 20px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          {_info_row("Dipendente", employee_name)}
          {_info_row("Tipo", f'<span style="display:inline-block;padding:2px 8px;background:{type_color}1a;color:{type_color};border-radius:4px;font-size:12px;font-weight:700;">{type_label}</span>')}
          {_info_row("Periodo", period)}
          {_info_row("Stato", f'<span style="display:inline-block;padding:2px 8px;background:{status_color}1a;color:{status_color};border-radius:4px;font-size:12px;font-weight:700;">{status_label}</span>')}
        </table>
      </td></tr>
    </table>
    """

    _send(emails, subject, text, _wrap_html(subject, body_html, f"Richiesta {status_label.lower()} da {approver_name}"))


def _web_base_url() -> str:
    base = settings.public_web_base_url.strip()
    if not base:
        base = settings.public_api_base_url.strip().rstrip("/").removesuffix("/api")
    return base.rstrip("/")


def notify_device_delivery_signature_request(db: Session, delivery: DeviceDelivery, requested_by: str) -> None:
    """Invita il dipendente a firmare (o aggiornare la firma di) una consegna
    dispositivo dal portale. Il link non contiene alcun token: la pagina
    richiede il login e il backend verifica che il firmatario sia l'assegnatario."""
    employee_email = get_employee_email(db, delivery.employee_id)
    if not employee_email:
        return

    employee_name = delivery.employee.full_name if delivery.employee else ""
    sign_url = f"{_web_base_url()}/le-mie-consegne/{delivery.id}/firma"
    is_update = bool(delivery.signature_b64)
    action_label = "aggiornare la firma" if is_update else "firmare la presa in consegna"

    subject = f"Firma richiesta — consegna {delivery.device_label}"
    text = (
        f"Ciao {employee_name},\n\n"
        f"ti è stato assegnato il dispositivo {delivery.device_label} e ti chiediamo di {action_label}.\n"
        f"Accedi al portale con le tue credenziali aziendali e firma qui:\n\n"
        f"{sign_url}\n\n"
        f"Richiesta inviata da {requested_by}.\n\n"
        f"— T-Hub Workforce Planner · Tonoli S.p.A."
    )

    body_html = f"""
    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#2B2B2B;margin:0 0 6px;">
      Firma della consegna dispositivo
    </p>
    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;color:#555;margin:0 0 24px;line-height:1.5;">
      Ciao {employee_name}, ti chiediamo di {action_label} del dispositivo che ti è stato assegnato.
    </p>

    <!-- Info card -->
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f8f8f6;border-radius:8px;border-left:4px solid #007040;padding:4px 0;">
      <tr><td style="padding:16px 20px;">
        <table cellpadding="0" cellspacing="0" border="0" width="100%">
          {_info_row("Dipendente", employee_name)}
          {_info_row("Dispositivo", delivery.device_label)}
          {_info_row("Consegnato il", delivery.delivered_at.strftime("%d/%m/%Y") if delivery.delivered_at else "—")}
        </table>
      </td></tr>
    </table>

    <table cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">
      <tr>
        <td>
          <a href="{sign_url}" style="display:inline-block;background:#007040;color:#ffffff;font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;text-decoration:none;">Firma la consegna</a>
        </td>
      </tr>
    </table>

    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:13px;color:#6c757d;margin:16px 0 0;line-height:1.5;">
      Il link apre il portale T-Hub: ti verrà chiesto di accedere con le tue credenziali aziendali,
      di leggere la policy di sicurezza e poi potrai firmare direttamente dalla pagina.
      La firma sostituisce quella eventualmente già registrata.
    </p>
    """
    _send([employee_email], subject, text, _wrap_html(subject, body_html, f"Firma richiesta per {delivery.device_label}"))


def send_operational_reporting_reminder(
    email: str,
    owner_name: str,
    notifications: list[dict],
) -> bool:
    """Invia in modo sincrono il riepilogo delle rendicontazioni mancanti.

    Il chiamante gira già fuori dall'event loop e registra la data solo dopo
    una consegna SMTP riuscita, così un errore non viene scambiato per invio.
    """
    if not settings.smtp_enabled or not settings.smtp_host or not email or not notifications:
        return False

    work_date = notifications[0]["work_date"]
    reporting_url = f"{_web_base_url()}/rendicontazioni/operativa?day={work_date.isoformat()}"
    total_missing = sum(item["missing_count"] for item in notifications)
    subject = f"Rendicontazioni da completare — {work_date.strftime('%d/%m/%Y')}"
    text_lines = [
        f"Ciao {owner_name},",
        "",
        f"alle ore 10:00 risultano {total_missing} rendicontazioni da completare per il "
        f"{work_date.strftime('%d/%m/%Y')}:",
        "",
    ]
    rows = []
    for item in notifications:
        # Le etichette distinguono chi non ha confermato da chi ha confermato
        # una giornata parziale; sulle rendicontazioni storiche mancano.
        names = ", ".join(item.get("missing_employee_labels") or item["missing_employee_names"])
        text_lines.append(f"- {item['team_name']}: {names}")
        rows.append(
            "<tr>"
            f"<td style=\"padding:10px 12px;border-bottom:1px solid #e8e8e4;font-weight:700;\">{escape(item['team_name'])}</td>"
            f"<td style=\"padding:10px 12px;border-bottom:1px solid #e8e8e4;\">{escape(names)}</td>"
            "</tr>"
        )
    text_lines.extend(["", f"Apri T-Hub: {reporting_url}", "", "— T-Hub Workforce Planner · Tonoli S.p.A."])

    body_html = f"""
    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#2B2B2B;margin:0 0 6px;">
      Rendicontazioni da completare
    </p>
    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;color:#555;margin:0 0 20px;line-height:1.5;">
      Ciao {escape(owner_name)}, alle ore 10:00 risultano da completare
      <strong>{total_missing}</strong> {'rendicontazione' if total_missing == 1 else 'rendicontazioni'}
      del {work_date.strftime('%d/%m/%Y')}: non confermate, oppure confermate senza coprire
      tutto il tempo pianificato.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f8f8f6;border-radius:8px;border-left:4px solid #d97706;font-size:13px;">
      <tr>
        <th align="left" style="padding:10px 12px;border-bottom:1px solid #deded8;">Squadra</th>
        <th align="left" style="padding:10px 12px;border-bottom:1px solid #deded8;">Persone da completare</th>
      </tr>
      {''.join(rows)}
    </table>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">
      <tr><td>
        <a href="{reporting_url}" style="display:inline-block;background:#007040;color:#ffffff;font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;text-decoration:none;">Apri la rendicontazione</a>
      </td></tr>
    </table>
    """
    return _send_sync(
        [email],
        subject,
        "\n".join(text_lines),
        _wrap_html(subject, body_html, f"{total_missing} rendicontazioni da completare"),
    )


_MAINTENANCE_URGENCY_LABELS = {"scaduta": "Scaduta", "urgente": "Urgente", "in_scadenza": "In scadenza"}


def send_maintenance_deadline_reminder(
    email: str,
    recipient_name: str,
    deadlines: list[dict],
) -> bool:
    """Promemoria giornaliero delle scadenze manutenzioni sopra soglia (§10).

    Come per send_operational_reporting_reminder, il chiamante gira fuori
    dall'event loop e registra last_notice_email_date solo dopo un invio
    riuscito.
    """
    if not settings.smtp_enabled or not settings.smtp_host or not email or not deadlines:
        return False

    overdue = sum(1 for item in deadlines if item["urgency"] == "scaduta")
    subject = f"Manutenzioni: {len(deadlines)} {'scadenza' if len(deadlines) == 1 else 'scadenze'} da presidiare"
    dashboard_url = f"{_web_base_url()}/manutenzioni/scadenze"

    text_lines = [f"Ciao {recipient_name},", "", "risultano da presidiare le seguenti scadenze:", ""]
    rows = []
    for item in sorted(deadlines, key=lambda i: i["due_date"]):
        label = _MAINTENANCE_URGENCY_LABELS[item["urgency"]]
        due = item["due_date"].strftime("%d/%m/%Y")
        text_lines.append(f"- [{label}] {item['asset_internal_code']} · {item['deadline_type']} · {due}")
        rows.append(
            "<tr>"
            f"<td style=\"padding:10px 12px;border-bottom:1px solid #e8e8e4;font-weight:700;\">{escape(item['asset_internal_code'])}</td>"
            f"<td style=\"padding:10px 12px;border-bottom:1px solid #e8e8e4;\">{escape(item['deadline_type'])}</td>"
            f"<td style=\"padding:10px 12px;border-bottom:1px solid #e8e8e4;\">{due}</td>"
            f"<td style=\"padding:10px 12px;border-bottom:1px solid #e8e8e4;\">{escape(label)}</td>"
            "</tr>"
        )
    text_lines.extend(["", f"Apri T-Hub: {dashboard_url}", "", "— T-Hub Workforce Planner · Tonoli S.p.A."])

    body_html = f"""
    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;color:#2B2B2B;margin:0 0 6px;">
      Scadenze manutenzioni da presidiare
    </p>
    <p style="font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;color:#555;margin:0 0 20px;line-height:1.5;">
      Ciao {escape(recipient_name)}, risultano <strong>{len(deadlines)}</strong>
      {'scadenza' if len(deadlines) == 1 else 'scadenze'} da presidiare{f", di cui {overdue} già scadute" if overdue else ""}.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" border="0"
           style="background:#f8f8f6;border-radius:8px;border-left:4px solid #d97706;font-size:13px;">
      <tr>
        <th align="left" style="padding:10px 12px;border-bottom:1px solid #deded8;">Asset</th>
        <th align="left" style="padding:10px 12px;border-bottom:1px solid #deded8;">Tipo scadenza</th>
        <th align="left" style="padding:10px 12px;border-bottom:1px solid #deded8;">Scadenza</th>
        <th align="left" style="padding:10px 12px;border-bottom:1px solid #deded8;">Stato</th>
      </tr>
      {''.join(rows)}
    </table>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:22px 0 4px;">
      <tr><td>
        <a href="{dashboard_url}" style="display:inline-block;background:#007040;color:#ffffff;font-family:'Lexend',Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;padding:12px 18px;border-radius:8px;text-decoration:none;">Apri le scadenze</a>
      </td></tr>
    </table>
    """
    return _send_sync(
        [email],
        subject,
        "\n".join(text_lines),
        _wrap_html(subject, body_html, f"{len(deadlines)} scadenze manutenzioni da presidiare"),
    )

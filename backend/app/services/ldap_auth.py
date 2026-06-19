from datetime import datetime, timezone

from fastapi import HTTPException, Request, status
from ldap3 import ALL, Connection, SIMPLE, Server
from ldap3.utils.conv import escape_filter_chars
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.enums import UserRole
from app.models import LdapEmployee, User
from app.schemas import AuthLoginRequest, TokenResponse
from app.services.audit import record_audit_log
from app.services.portal_auth import build_auth_user_read
from app.services.security import create_access_token


def _domain_to_base_dn(domain: str) -> str | None:
    parts = [part.strip() for part in domain.split(".") if part.strip()]
    if not parts:
        return None
    return ",".join(f"DC={part}" for part in parts)


def _resolve_default_role() -> UserRole:
    configured = settings.ldap_default_role.strip().upper()
    for role in UserRole:
        if role.value == configured or role.name.upper() == configured:
            return role
    raise RuntimeError("Invalid LDAP_DEFAULT_ROLE configuration.")


def _resolve_allowed_group(conn: Connection, group_base: str) -> tuple[str | None, str | None]:
    configured_group = settings.ldap_allowed_group.strip()
    if not configured_group:
        return None, None

    if "=" in configured_group:
        group_dn = configured_group
        group_cn = None
        first_rdn = group_dn.split(",", 1)[0]
        if first_rdn.upper().startswith("CN="):
            group_cn = first_rdn[3:]
        return group_dn, group_cn

    group_cn = configured_group
    group_filter = f"(&(objectClass=group)(cn={escape_filter_chars(group_cn)}))"
    if not conn.search(group_base, group_filter, attributes=["distinguishedName"]):
        return None, group_cn
    if not conn.entries:
        return None, group_cn
    return str(conn.entries[0].entry_dn), group_cn


def _extract_attr(entry, attr_name: str) -> str | None:
    try:
        value = getattr(entry, attr_name).value
    except Exception:
        return None
    if value is None:
        return None
    return str(value).strip() or None


def authenticate_with_ldap(data: AuthLoginRequest, request: Request, db: Session) -> TokenResponse:
    username = data.username.strip()
    password = data.password

    if not username or not password:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali non valide.")

    if not settings.ldap_is_configured:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali non valide.")

    server = Server(settings.ldap_uri, get_info=ALL, connect_timeout=10)
    user_principal_name = f"{username}@{settings.ldap_domain}"
    conn = None

    try:
        conn = Connection(
            server,
            user=user_principal_name,
            password=password,
            authentication=SIMPLE,
            raise_exceptions=True,
        )
        if not conn.bind():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali non valide.")

        user_base = settings.ldap_user_dn or _domain_to_base_dn(settings.ldap_domain)
        group_base = settings.ldap_group_dn or _domain_to_base_dn(settings.ldap_domain)
        user_entry = None

        if user_base:
            escaped_username = escape_filter_chars(username)
            escaped_upn = escape_filter_chars(user_principal_name)
            user_filter = f"(|(sAMAccountName={escaped_username})(userPrincipalName={escaped_upn}))"
            conn.search(user_base, user_filter, attributes=["displayName", "mail", "memberOf", "distinguishedName"])
            if conn.entries:
                user_entry = conn.entries[0]

        if settings.ldap_allowed_group.strip():
            if not user_entry or not group_base:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso negato.")

            allowed_group_dn, allowed_group_cn = _resolve_allowed_group(conn, group_base)
            if not allowed_group_dn:
                raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso negato.")

            try:
                member_of = [str(item) for item in getattr(user_entry, "memberOf", [])]
            except Exception:
                member_of = []

            in_group = any(item.strip().lower() == allowed_group_dn.strip().lower() for item in member_of)
            user_dn = str(user_entry.entry_dn)

            if not in_group:
                if allowed_group_cn:
                    fallback_filter = f"(&(objectClass=group)(cn={escape_filter_chars(allowed_group_cn)})(member={escape_filter_chars(user_dn)}))"
                else:
                    fallback_filter = f"(&(objectClass=group)(member={escape_filter_chars(user_dn)}))"
                found = conn.search(group_base, fallback_filter, attributes=["cn"]) and bool(conn.entries)
                if not found:
                    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso negato.")

        display_name = _extract_attr(user_entry, "displayName") if user_entry else None
        email = _extract_attr(user_entry, "mail") if user_entry else None
        distinguished_name = str(user_entry.entry_dn).strip() if user_entry else None

        user = db.scalars(select(User).where(func.lower(User.username) == username.lower())).first()
        if user is None:
            user = User(username=username, display_name=display_name or username, role=_resolve_default_role(), is_active=True)
            db.add(user)
            db.flush()
        elif display_name:
            user.display_name = display_name

        if not user.is_active:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Account non abilitato.")

        logged_at = datetime.now(timezone.utc)
        ldap_employee = db.scalars(select(LdapEmployee).where(func.lower(LdapEmployee.username) == username.lower())).first()
        if ldap_employee is None:
            ldap_employee = LdapEmployee(
                username=username,
                display_name=display_name or user.display_name or username,
                email=email,
                distinguished_name=distinguished_name,
                auth_user=user,
                first_login_at=logged_at,
                last_login_at=logged_at,
                is_active=True,
            )
            db.add(ldap_employee)
        else:
            ldap_employee.display_name = display_name or ldap_employee.display_name or user.display_name or username
            ldap_employee.email = email
            ldap_employee.distinguished_name = distinguished_name
            ldap_employee.auth_user = user
            ldap_employee.last_login_at = logged_at
            ldap_employee.is_active = True
            if ldap_employee.first_login_at is None:
                ldap_employee.first_login_at = logged_at

        record_audit_log(
            db,
            action="login",
            entity="auth",
            actor_name=user.username,
            user_id=user.id,
            detail={
                "provider": "ldap",
                "logged_at": logged_at.isoformat(),
                "ip_address": request.client.host if request.client else None,
                "user_agent": request.headers.get("user-agent"),
                "email": email,
            },
        )
        db.commit()
        db.refresh(user)

        token = create_access_token(subject=user.username, role=user.role.value)
        return TokenResponse(
            access_token=token,
            token_type="bearer",
            expires_in=settings.jwt_expire_minutes * 60,
            user=build_auth_user_read(db, user),
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Credenziali non valide.") from exc
    finally:
        if conn is not None:
            try:
                conn.unbind()
            except Exception:
                pass

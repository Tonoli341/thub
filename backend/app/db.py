from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


INITIAL_OPERATIONAL_AREAS = [
    ("KIMBERLY", "Kimberly", "Area operativa Kimberly"),
    ("SEDE", "Sede", "Area operativa Sede"),
    ("ROSSANA", "Rossana", "Area operativa Rossana"),
    ("VILLAR", "Villar", "Area operativa Villar"),
    ("DRONERO", "Dronero", "Area operativa Dronero"),
    ("FOSSANO", "Fossano", "Area operativa Fossano"),
    ("COSTIGLIOLE", "Costigliole", "Area operativa Costigliole"),
]


class Base(DeclarativeBase):
    pass


engine = create_engine(settings.database_url, pool_pre_ping=True)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False)


def get_db() -> Generator[Session, None, None]:
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def ensure_schema_updates() -> None:
    inspector = inspect(engine)
    if inspector.has_table("employees"):
        columns = {column["name"] for column in inspector.get_columns("employees")}
        with engine.begin() as connection:
            if "default_operational_area_id" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN default_operational_area_id VARCHAR(36)"))
            if "photo_jpeg" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN photo_jpeg BYTEA"))
            if "manager_employee_id" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN manager_employee_id VARCHAR(36)"))
            if "absence_can_request_for_self" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_can_request_for_self BOOLEAN DEFAULT TRUE NOT NULL"))
            if "absence_can_request_for_reports" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_can_request_for_reports BOOLEAN DEFAULT FALSE NOT NULL"))
            if "absence_can_request_for_all" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_can_request_for_all BOOLEAN DEFAULT FALSE NOT NULL"))
            if "absence_allowed_role_descriptions" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_allowed_role_descriptions TEXT"))
            if "absence_requires_approval" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_requires_approval BOOLEAN DEFAULT TRUE NOT NULL"))
            if "absence_approver_1_employee_id" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_approver_1_employee_id VARCHAR(36)"))
            if "absence_approver_2_employee_id" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_approver_2_employee_id VARCHAR(36)"))
            if "absence_approver_3_employee_id" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_approver_3_employee_id VARCHAR(36)"))
            if "config_can_access_planning" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_can_access_planning BOOLEAN DEFAULT FALSE NOT NULL"))
            if "config_can_access_organization" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_can_access_organization BOOLEAN DEFAULT FALSE NOT NULL"))
            if "app_role" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN app_role VARCHAR(16)"))
            if "planner_scope" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN planner_scope VARCHAR(16) DEFAULT 'self' NOT NULL"))
            if "tms_role_code" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN tms_role_code VARCHAR(16)"))
            if "tms_role_description" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN tms_role_description VARCHAR(120)"))
            if "datore_lavoro" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN datore_lavoro VARCHAR(255)"))
            if "organization_function" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN organization_function VARCHAR(120)"))
            if "organization_department" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN organization_department VARCHAR(120)"))
            if "organization_role" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN organization_role VARCHAR(64)"))
            if "default_schedule" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN default_schedule JSONB"))
            if "default_immobile" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN default_immobile VARCHAR(32)"))
            if "phone_from_tms" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN phone_from_tms BOOLEAN DEFAULT FALSE NOT NULL"))
            connection.execute(text("UPDATE employees SET phone_from_tms = TRUE WHERE phone IS NOT NULL AND phone_from_tms = FALSE"))
    if inspector.has_table("operational_areas"):
        col_map = {col["name"]: col for col in inspector.get_columns("operational_areas")}
        with engine.begin() as connection:
            if "buildings" not in col_map:
                connection.execute(text("ALTER TABLE operational_areas ADD COLUMN buildings JSONB NOT NULL DEFAULT '[]'"))
            elif "JSON" not in str(col_map["buildings"]["type"]).upper():
                connection.execute(text("ALTER TABLE operational_areas ALTER COLUMN buildings DROP DEFAULT"))
                connection.execute(text("ALTER TABLE operational_areas ALTER COLUMN buildings TYPE JSONB USING buildings::jsonb"))
                connection.execute(text("ALTER TABLE operational_areas ALTER COLUMN buildings SET DEFAULT '[]'"))
    if inspector.has_table("assignments"):
        columns = {column["name"] for column in inspector.get_columns("assignments")}
        with engine.begin() as connection:
            if "immobile" not in columns:
                connection.execute(text("ALTER TABLE assignments ADD COLUMN immobile VARCHAR(32)"))
    if inspector.has_table("justifications"):
        columns = {column["name"] for column in inspector.get_columns("justifications")}
        with engine.begin() as connection:
            if "approval_status" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN approval_status VARCHAR(32) DEFAULT 'APPROVED' NOT NULL"))
            if "approval_required" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN approval_required BOOLEAN DEFAULT FALSE NOT NULL"))
            if "requested_by_employee_id" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN requested_by_employee_id VARCHAR(36)"))
            if "approver_1_employee_id" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN approver_1_employee_id VARCHAR(36)"))
            if "approver_2_employee_id" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN approver_2_employee_id VARCHAR(36)"))
            if "approver_3_employee_id" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN approver_3_employee_id VARCHAR(36)"))
    if inspector.has_table("ldap_employees"):
        columns = {column["name"] for column in inspector.get_columns("ldap_employees")}
        with engine.begin() as connection:
            if "tms_employee_id" not in columns:
                connection.execute(text("ALTER TABLE ldap_employees ADD COLUMN tms_employee_id VARCHAR(36)"))
    if inspector.has_table("timesheet_workers"):
        columns = {column["name"] for column in inspector.get_columns("timesheet_workers")}
        with engine.begin() as connection:
            if "tms_employee_id" not in columns:
                connection.execute(text("ALTER TABLE timesheet_workers ADD COLUMN tms_employee_id VARCHAR(36)"))
    if inspector.has_table("org_functions"):
        columns = {column["name"] for column in inspector.get_columns("org_functions")}
        with engine.begin() as connection:
            if "responsible_employee_id" not in columns:
                connection.execute(text("ALTER TABLE org_functions ADD COLUMN responsible_employee_id VARCHAR(36)"))
    if inspector.has_table("org_departments"):
        columns = {column["name"] for column in inspector.get_columns("org_departments")}
        with engine.begin() as connection:
            if "responsible_employee_id" not in columns:
                connection.execute(text("ALTER TABLE org_departments ADD COLUMN responsible_employee_id VARCHAR(36)"))
            if "function_id" not in columns:
                connection.execute(text("ALTER TABLE org_departments ADD COLUMN function_id VARCHAR(36)"))
    if inspector.has_table("teams"):
        columns = {column["name"] for column in inspector.get_columns("teams")}
        with engine.begin() as connection:
            if "team_leader_employee_id" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN team_leader_employee_id VARCHAR(36)"))
            if "reports_to_employee_id" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN reports_to_employee_id VARCHAR(36)"))
            if "organization_function" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN organization_function VARCHAR(120)"))
            if "organization_department" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN organization_department VARCHAR(120)"))
            if "team_leader_2_employee_id" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN team_leader_2_employee_id VARCHAR(36)"))


def seed_operational_areas() -> None:
    from app.models import OperationalArea

    with SessionLocal() as session:
        for area_code, name, description in INITIAL_OPERATIONAL_AREAS:
            existing = session.query(OperationalArea).filter(OperationalArea.area_code == area_code).first()
            if existing is None:
                existing = session.query(OperationalArea).filter(OperationalArea.name == name).first()
            if existing is None:
                session.add(OperationalArea(area_code=area_code, name=name, description=description, is_active=True, is_operational=True))
        session.commit()


def seed_portal_user() -> None:
    from app.services.portal_auth import ensure_portal_user

    with SessionLocal() as session:
        ensure_portal_user(session)
        session.commit()


def backfill_ldap_employees() -> None:
    from app.models import LdapEmployee, User

    with SessionLocal() as session:
        users = session.query(User).all()
        existing_by_auth_user_id = {item.auth_user_id: item for item in session.query(LdapEmployee).filter(LdapEmployee.auth_user_id.is_not(None)).all()}
        for user in users:
            ldap_employee = existing_by_auth_user_id.get(user.id)
            if ldap_employee is None:
                session.add(LdapEmployee(username=user.username, display_name=user.display_name, auth_user_id=user.id, first_login_at=user.created_at, last_login_at=user.updated_at or user.created_at, is_active=user.is_active))
                continue
            if not ldap_employee.display_name and user.display_name:
                ldap_employee.display_name = user.display_name
            ldap_employee.is_active = user.is_active
            if ldap_employee.first_login_at is None:
                ldap_employee.first_login_at = user.created_at
            if ldap_employee.last_login_at is None:
                ldap_employee.last_login_at = user.updated_at or user.created_at
        session.commit()


def backfill_timesheet_worker_links() -> None:
    from app.services.timesheets import auto_link_timesheet_workers_by_matricola

    with SessionLocal() as session:
        auto_link_timesheet_workers_by_matricola(session)
        session.commit()


def seed_org_entities() -> None:
    from app.models import Employee, OrgDepartment, OrgFunction

    with SessionLocal() as session:
        existing_functions = session.query(Employee.organization_function).filter(
            Employee.organization_function.isnot(None),
            Employee.organization_function != "",
        ).distinct().all()
        for (fn_name,) in existing_functions:
            fn_name = (fn_name or "").strip()
            if fn_name:
                existing = session.query(OrgFunction).filter(OrgFunction.name == fn_name).first()
                if existing is None:
                    session.add(OrgFunction(name=fn_name, is_active=True))

        existing_departments = session.query(Employee.organization_department).filter(
            Employee.organization_department.isnot(None),
            Employee.organization_department != "",
        ).distinct().all()
        for (dept_name,) in existing_departments:
            dept_name = (dept_name or "").strip()
            if dept_name:
                existing = session.query(OrgDepartment).filter(OrgDepartment.name == dept_name).first()
                if existing is None:
                    session.add(OrgDepartment(name=dept_name, is_active=True))

        session.commit()


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    ensure_schema_updates()
    seed_operational_areas()
    seed_portal_user()
    backfill_ldap_employees()
    backfill_timesheet_worker_links()
    seed_org_entities()
    from app.services.org import propagate_org_inheritance
    with SessionLocal() as session:
        propagate_org_inheritance(session)
        session.commit()

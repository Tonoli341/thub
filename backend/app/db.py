from collections.abc import Generator

from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from app.config import settings


INITIAL_OPERATIONAL_AREAS = [
    ("KIMBERLY", "Kimberly", "Area operativa Kimberly"),
    ("SEDE", "Sede", "Area operativa Sede"),
    ("ROSSANA", "Rossana", "Area operativa Rossana"),
    ("DRONERO", "Dronero", "Area operativa Dronero"),
    ("FOSSANO", "Fossano", "Area operativa Fossano"),
    ("COSTIGLIOLE", "Costigliole", "Area operativa Costigliole"),
]

INITIAL_INFINITY_BILLING_ITEMS = [
    "CAMPIONATURA",
    "CART",
    "CROSS",
    "DDT",
    "EPAL",
    "FILE",
    "GENERICO",
    "HANDLING_IN",
    "HANDLING_OUT",
    "HOUSING_",
    "INV",
    "KIT",
    "LABELLING",
    "MOVINT",
    "PACKAGING",
    "PAL",
    "PICKING",
    "RICAVI E PROVENTI DIVERSI",
    "SMAL",
]

INITIAL_SIZE_GROUPS = [
    ("Abbigliamento", 1, ["XS", "S", "M", "L", "XL", "XXL", "3XL", "4XL", "S/M", "L/XL"]),
    ("Calzature", 2, ["36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47", "48"]),
    ("Guanti", 3, ["6", "7", "8", "9", "10", "11"]),
    ("Taglia unica", 4, ["Taglia unica"]),
]

SIZE_GROUP_KEYWORDS = [
    (["scarpe", "stivali", "calzature"], ["Calzature"]),
    (["guanti"], ["Guanti"]),
    (
        ["polo", "maglietta", "felpa", "gilet", "giubbotto", "tuta", "pile", "giacca", "camicia", "canotta", "maglia", "pantalone"],
        ["Abbigliamento"],
    ),
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


def _ensure_index(connection, *, table_name: str, index_name: str, column_expr: str, unique: bool, where_not_null: bool) -> None:
    desired_predicate = f"WHERE {column_expr} IS NOT NULL" if where_not_null else ""
    constraint_name = connection.execute(
        text(
            """
            SELECT c.conname
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE c.contype = 'u'
              AND t.relname = :table_name
              AND c.conname = :index_name
            """
        ),
        {"table_name": table_name, "index_name": index_name},
    ).scalar()
    if constraint_name:
        connection.execute(text(f"ALTER TABLE {table_name} DROP CONSTRAINT IF EXISTS {constraint_name}"))

    index_def = connection.execute(
        text("SELECT indexdef FROM pg_indexes WHERE tablename = :table_name AND indexname = :index_name"),
        {"table_name": table_name, "index_name": index_name},
    ).scalar()
    normalized_index_def = " ".join(str(index_def).upper().split()) if index_def else None
    expected_unique = "CREATE UNIQUE INDEX" if unique else "CREATE INDEX"
    normalized_predicate = " ".join(desired_predicate.upper().split()) if desired_predicate else None
    if index_def and (
        expected_unique not in normalized_index_def
        or (normalized_predicate and normalized_predicate not in normalized_index_def)
        or (not normalized_predicate and " WHERE " in normalized_index_def)
    ):
        connection.execute(text(f"DROP INDEX IF EXISTS {index_name}"))
        index_def = None
    if not index_def:
        connection.execute(
            text(
                f"CREATE {'UNIQUE ' if unique else ''}INDEX IF NOT EXISTS {index_name} "
                f"ON {table_name} ({column_expr})"
                + (f" WHERE {column_expr} IS NOT NULL" if where_not_null else "")
            )
        )


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
            if "absence_can_view_all" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_can_view_all BOOLEAN DEFAULT FALSE NOT NULL"))
            if "absence_can_edit_balances" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN absence_can_edit_balances BOOLEAN DEFAULT FALSE NOT NULL"))
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
            if "config_can_access_timesheets" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_can_access_timesheets BOOLEAN DEFAULT FALSE NOT NULL"))
            if "config_can_access_workloads" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_can_access_workloads BOOLEAN DEFAULT TRUE NOT NULL"))
            if "config_can_access_expirations" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_can_access_expirations BOOLEAN DEFAULT TRUE NOT NULL"))
            if "config_expirations_scope" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_expirations_scope VARCHAR(16) DEFAULT 'all' NOT NULL"))
                connection.execute(text("UPDATE employees SET config_expirations_scope = CASE WHEN config_can_access_expirations THEN 'all' ELSE 'none' END"))
            if "config_can_access_deliveries" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN config_can_access_deliveries BOOLEAN DEFAULT FALSE NOT NULL"))
            if "app_role" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN app_role VARCHAR(16)"))
            if "planner_access_level" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN planner_access_level VARCHAR(32)"))
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
            if "is_direttivo" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN is_direttivo BOOLEAN DEFAULT FALSE NOT NULL"))
            if "birth_date" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN birth_date DATE"))
            if "local_user_username" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN local_user_username VARCHAR(120)"))
            if "local_user_password_hash" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN local_user_password_hash TEXT"))
            if "local_user_password_expires_at" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN local_user_password_expires_at TIMESTAMPTZ"))
            if "local_user_password_updated_at" not in columns:
                connection.execute(text("ALTER TABLE employees ADD COLUMN local_user_password_updated_at TIMESTAMPTZ"))
            connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_employees_local_user_username ON employees (lower(local_user_username)) WHERE local_user_username IS NOT NULL"))
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
            if "break_start" not in columns:
                connection.execute(text("ALTER TABLE assignments ADD COLUMN break_start TIME"))
            if "break_end" not in columns:
                connection.execute(text("ALTER TABLE assignments ADD COLUMN break_end TIME"))
            if "immobile" not in columns:
                connection.execute(text("ALTER TABLE assignments ADD COLUMN immobile VARCHAR(32)"))
            if "workload" not in columns:
                connection.execute(text("ALTER TABLE assignments ADD COLUMN workload TEXT"))
            if "training_course_id" not in columns:
                connection.execute(text("ALTER TABLE assignments ADD COLUMN training_course_id VARCHAR(36)"))
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
            if "created_by_name" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN created_by_name VARCHAR(255)"))
            if "decided_by_name" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN decided_by_name VARCHAR(255)"))
            if "decided_by_employee_id" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN decided_by_employee_id VARCHAR(36)"))
            if "decided_by_user_id" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN decided_by_user_id VARCHAR(36)"))
            if "decided_at" not in columns:
                connection.execute(text("ALTER TABLE justifications ADD COLUMN decided_at TIMESTAMPTZ"))
    if inspector.has_table("ldap_employees"):
        columns = {column["name"] for column in inspector.get_columns("ldap_employees")}
        with engine.begin() as connection:
            if "tms_employee_id" not in columns:
                connection.execute(text("ALTER TABLE ldap_employees ADD COLUMN tms_employee_id VARCHAR(36)"))
            if "last_ad_sync_at" not in columns:
                connection.execute(text("ALTER TABLE ldap_employees ADD COLUMN last_ad_sync_at TIMESTAMPTZ"))
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
    if inspector.has_table("infinity_billing_customer_supplier_map"):
        col_map = {col["name"]: col for col in inspector.get_columns("infinity_billing_customer_supplier_map")}
        # Il vincolo univoco copriva solo (voce, codice cliente/fornitore),
        # impedendo più incroci per lo stesso cliente verso la stessa voce
        # Infinity (es. MAINA/DDT IN -> DDT e MAINA/DDT OUT -> DDT). Ora
        # include anche jupiter_description, il campo con cui questi incroci
        # si distinguono tra loro.
        unique_constraints = inspector.get_unique_constraints("infinity_billing_customer_supplier_map")
        legacy_pair_constraint = next(
            (uc for uc in unique_constraints if uc["column_names"] == ["infinity_billing_item_id", "customer_supplier_code"]),
            None,
        )
        constraint_names = {uc["name"] for uc in unique_constraints}
        with engine.begin() as connection:
            if "jupiter_description" not in col_map:
                connection.execute(text("ALTER TABLE infinity_billing_customer_supplier_map ADD COLUMN jupiter_description TEXT"))
            if "operational_area_id" not in col_map:
                connection.execute(text("ALTER TABLE infinity_billing_customer_supplier_map ADD COLUMN operational_area_id VARCHAR(36)"))
            if "buildings" not in col_map:
                connection.execute(text("ALTER TABLE infinity_billing_customer_supplier_map ADD COLUMN buildings JSONB NOT NULL DEFAULT '[]'"))
            elif "JSON" not in str(col_map["buildings"]["type"]).upper():
                connection.execute(text("ALTER TABLE infinity_billing_customer_supplier_map ALTER COLUMN buildings DROP DEFAULT"))
                connection.execute(text("ALTER TABLE infinity_billing_customer_supplier_map ALTER COLUMN buildings TYPE JSONB USING buildings::jsonb"))
                connection.execute(text("ALTER TABLE infinity_billing_customer_supplier_map ALTER COLUMN buildings SET DEFAULT '[]'"))
            if legacy_pair_constraint:
                connection.execute(
                    text(f'ALTER TABLE infinity_billing_customer_supplier_map DROP CONSTRAINT "{legacy_pair_constraint["name"]}"')
                )
            if legacy_pair_constraint or "uq_infinity_billing_customer_supplier_map_pair" not in constraint_names:
                connection.execute(
                    text(
                        "ALTER TABLE infinity_billing_customer_supplier_map "
                        "ADD CONSTRAINT uq_infinity_billing_customer_supplier_map_pair "
                        "UNIQUE (infinity_billing_item_id, customer_supplier_code, jupiter_description)"
                    )
                )
    if inspector.has_table("field_definitions"):
        # config: {source, key_column, columns} per i campi "mssql_list" (la SQL
        # sta solo nel registro server-side). Nullable senza backfill: gli altri
        # tipi non la usano. Le migration Alembic non girano all'avvio.
        columns = {column["name"] for column in inspector.get_columns("field_definitions")}
        with engine.begin() as connection:
            if "config" not in columns:
                connection.execute(text("ALTER TABLE field_definitions ADD COLUMN config JSON"))
    if inspector.has_table("active_activities"):
        # Sostituisce i vincoli dei modelli precedenti — single-session (unique
        # sul solo employee_id) e multi-timer per incrocio (employee_id,
        # mapping_id) — con quello attuale per tripla (employee_id, mapping_id,
        # conflict_key): più timer sullo stesso incrocio se i campi obbligatori
        # differiscono. Le migration Alembic non girano all'avvio. Drop prima,
        # add poi: i vecchi vincoli sono più stretti, quindi non possono
        # esistere triple duplicate. Il backfill a '' dei timer già aperti è
        # corretto: sotto i vecchi vincoli ne esiste al più uno per incrocio.
        columns = {column["name"] for column in inspector.get_columns("active_activities")}
        unique_constraints = inspector.get_unique_constraints("active_activities")
        unique_indexes = [idx for idx in inspector.get_indexes("active_activities") if idx.get("unique")]
        constraint_names = {uc["name"] for uc in unique_constraints}
        legacy_column_sets = (["employee_id"], ["employee_id", "mapping_id"])
        with engine.begin() as connection:
            if "conflict_key" not in columns:
                connection.execute(text("ALTER TABLE active_activities ADD COLUMN conflict_key VARCHAR(64) NOT NULL DEFAULT ''"))
            for uc in unique_constraints:
                if uc["column_names"] in legacy_column_sets:
                    connection.execute(text(f'ALTER TABLE active_activities DROP CONSTRAINT "{uc["name"]}"'))
            for idx in unique_indexes:
                if idx["column_names"] in legacy_column_sets and idx["name"] not in constraint_names:
                    connection.execute(text(f'DROP INDEX "{idx["name"]}"'))
            if "uq_active_activity_employee_mapping_conflict" not in constraint_names:
                connection.execute(text("ALTER TABLE active_activities ADD CONSTRAINT uq_active_activity_employee_mapping_conflict UNIQUE (employee_id, mapping_id, conflict_key)"))
        # Ricalcola la conflict_key dei timer aperti rimasti a '' il cui
        # incrocio ha campi obbligatori (colonna appena aggiunta, o campo reso
        # obbligatorio dopo lo start del timer).
        from app.models import ActiveActivity
        from app.services.active_activities import compute_conflict_key, required_fields

        with SessionLocal() as session:
            required_cache: dict[str, dict[str, str]] = {}
            dirty = False
            for timer in session.query(ActiveActivity).filter(ActiveActivity.conflict_key == "").all():
                if timer.mapping_id not in required_cache:
                    required_cache[timer.mapping_id] = required_fields(session, timer.mapping_id)
                conflict_key = compute_conflict_key(required_cache[timer.mapping_id], timer.field_values)
                if conflict_key != timer.conflict_key:
                    timer.conflict_key = conflict_key
                    dirty = True
            if dirty:
                session.commit()
    with engine.begin() as connection:
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS team_daily_notes (
                id VARCHAR(36) PRIMARY KEY,
                team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
                work_date DATE NOT NULL,
                workload TEXT,
                table_rows JSONB NOT NULL DEFAULT '[]',
                owner_employee_id VARCHAR(36),
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_team_daily_note UNIQUE (team_id, work_date)
            )
        """))
        connection.execute(text("""
            CREATE TABLE IF NOT EXISTS daily_records (
                id VARCHAR(36) PRIMARY KEY,
                employee_id VARCHAR(36) NOT NULL REFERENCES employees(id),
                operational_area_id VARCHAR(36),
                building VARCHAR(50),
                date DATE NOT NULL,
                started_at TIMESTAMPTZ NOT NULL,
                ended_at TIMESTAMPTZ,
                pauses JSONB NOT NULL DEFAULT '[]',
                work_seconds INTEGER,
                pause_seconds INTEGER,
                created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                CONSTRAINT uq_daily_record_employee_date UNIQUE (employee_id, date)
            )
        """))
    if inspector.has_table("team_daily_notes"):
        col_map = {col["name"]: col for col in inspector.get_columns("team_daily_notes")}
        with engine.begin() as connection:
            if "table_rows" not in col_map:
                connection.execute(text("ALTER TABLE team_daily_notes ADD COLUMN table_rows JSONB NOT NULL DEFAULT '[]'"))
            elif "JSON" not in str(col_map["table_rows"]["type"]).upper():
                connection.execute(text("ALTER TABLE team_daily_notes ALTER COLUMN table_rows DROP DEFAULT"))
                connection.execute(text("ALTER TABLE team_daily_notes ALTER COLUMN table_rows TYPE JSONB USING table_rows::jsonb"))
                connection.execute(text("ALTER TABLE team_daily_notes ALTER COLUMN table_rows SET DEFAULT '[]'"))
            if "owner_employee_id" not in col_map:
                connection.execute(text("ALTER TABLE team_daily_notes ADD COLUMN owner_employee_id VARCHAR(36)"))
    if inspector.has_table("daily_records"):
        col_map = {col["name"]: col for col in inspector.get_columns("daily_records")}
        with engine.begin() as connection:
            if "operational_area_id" not in col_map:
                connection.execute(text("ALTER TABLE daily_records ADD COLUMN operational_area_id VARCHAR(36)"))
            if "building" not in col_map:
                connection.execute(text("ALTER TABLE daily_records ADD COLUMN building VARCHAR(50)"))
            if "ended_at" not in col_map:
                connection.execute(text("ALTER TABLE daily_records ADD COLUMN ended_at TIMESTAMPTZ"))
            if "pauses" not in col_map:
                connection.execute(text("ALTER TABLE daily_records ADD COLUMN pauses JSONB NOT NULL DEFAULT '[]'"))
            elif "JSON" not in str(col_map["pauses"]["type"]).upper():
                connection.execute(text("ALTER TABLE daily_records ALTER COLUMN pauses DROP DEFAULT"))
                connection.execute(text("ALTER TABLE daily_records ALTER COLUMN pauses TYPE JSONB USING pauses::jsonb"))
                connection.execute(text("ALTER TABLE daily_records ALTER COLUMN pauses SET DEFAULT '[]'"))
            if "work_seconds" not in col_map:
                connection.execute(text("ALTER TABLE daily_records ADD COLUMN work_seconds INTEGER"))
            if "pause_seconds" not in col_map:
                connection.execute(text("ALTER TABLE daily_records ADD COLUMN pause_seconds INTEGER"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_records_employee_id ON daily_records (employee_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_records_operational_area_id ON daily_records (operational_area_id)"))
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_daily_records_date ON daily_records (date)"))
    # Indici per le query più frequenti (planner per giorno, assenze per dipendente/periodo,
    # consultazione audit): operazioni idempotenti che non toccano i dati.
    with engine.begin() as connection:
        if inspector.has_table("assignments"):
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_assignments_work_date_employee ON assignments (work_date, employee_id)"))
        if inspector.has_table("justifications"):
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_justifications_employee_period ON justifications (employee_id, start_date, end_date)"))
        if inspector.has_table("audit_logs"):
            connection.execute(text("CREATE INDEX IF NOT EXISTS ix_audit_logs_created_at ON audit_logs (created_at)"))
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
            if "workload_owner_employee_id" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN workload_owner_employee_id VARCHAR(36)"))
            if "operational_reporting_owner_employee_id" not in columns:
                connection.execute(text("ALTER TABLE teams ADD COLUMN operational_reporting_owner_employee_id VARCHAR(36)"))
                connection.execute(text(
                    "UPDATE teams SET operational_reporting_owner_employee_id = reports_to_employee_id "
                    "WHERE operational_reporting_owner_employee_id IS NULL"
                ))
            if "operational_reporting_notifications_enabled" not in columns:
                connection.execute(text(
                    "ALTER TABLE teams ADD COLUMN operational_reporting_notifications_enabled "
                    "BOOLEAN DEFAULT FALSE NOT NULL"
                ))
    if inspector.has_table("device_assets"):
        col_map = {col["name"]: col for col in inspector.get_columns("device_assets")}
        with engine.begin() as connection:
            if "ninja_device_id" not in col_map:
                connection.execute(text("ALTER TABLE device_assets ADD COLUMN ninja_device_id VARCHAR(64)"))
            if "system_name" not in col_map:
                connection.execute(text("ALTER TABLE device_assets ADD COLUMN system_name VARCHAR(160)"))
            if "node_class" not in col_map:
                connection.execute(text("ALTER TABLE device_assets ADD COLUMN node_class VARCHAR(60)"))
            if "serial_number" in col_map and not col_map["serial_number"]["nullable"]:
                connection.execute(text("ALTER TABLE device_assets ALTER COLUMN serial_number DROP NOT NULL"))
            # Indici unique parziali (WHERE ... IS NOT NULL): questi campi sono
            # serial_number non e' unique: NinjaOne puo' restituire lo stesso
            # seriale per piu' asset. ninja_device_id invece resta unique parziale.
            _ensure_index(
                connection,
                table_name="device_assets",
                index_name="ix_device_assets_serial_number",
                column_expr="serial_number",
                unique=False,
                where_not_null=False,
            )
            _ensure_index(
                connection,
                table_name="device_assets",
                index_name="ix_device_assets_ninja_device_id",
                column_expr="ninja_device_id",
                unique=True,
                where_not_null=True,
            )
    if inspector.has_table("device_deliveries"):
        col_map = {col["name"]: col for col in inspector.get_columns("device_deliveries")}
        with engine.begin() as connection:
            if "signature_b64" in col_map and not col_map["signature_b64"]["nullable"]:
                connection.execute(text("ALTER TABLE device_deliveries ALTER COLUMN signature_b64 DROP NOT NULL"))
            if "redelivered_to_delivery_id" not in col_map:
                connection.execute(text("ALTER TABLE device_deliveries ADD COLUMN redelivered_to_delivery_id VARCHAR(36)"))
                connection.execute(text("CREATE INDEX IF NOT EXISTS ix_device_deliveries_redelivered_to_delivery_id ON device_deliveries (redelivered_to_delivery_id)"))
            if "signature_source" not in col_map:
                connection.execute(text("ALTER TABLE device_deliveries ADD COLUMN signature_source VARCHAR(20)"))
                # Le firme raccolte finora arrivavano tutte dall'app tablet.
                connection.execute(text("UPDATE device_deliveries SET signature_source = 'tablet' WHERE signature_b64 IS NOT NULL"))
            if "signed_at" not in col_map:
                connection.execute(text("ALTER TABLE device_deliveries ADD COLUMN signed_at TIMESTAMPTZ"))
            if "signature_requested_at" not in col_map:
                connection.execute(text("ALTER TABLE device_deliveries ADD COLUMN signature_requested_at TIMESTAMPTZ"))


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


def seed_infinity_billing_items() -> None:
    from app.models import InfinityBillingItem

    with SessionLocal() as session:
        for name in INITIAL_INFINITY_BILLING_ITEMS:
            existing = session.query(InfinityBillingItem).filter(InfinityBillingItem.name == name).first()
            if existing is None:
                session.add(InfinityBillingItem(name=name, is_active=True))
        session.commit()


def seed_delivery_size_groups() -> None:
    from app.models import SizeGroup, SizeOption

    with SessionLocal() as session:
        if session.query(SizeGroup).first() is not None:
            return
        for name, sort_order, options in INITIAL_SIZE_GROUPS:
            group = SizeGroup(name=name, sort_order=sort_order)
            session.add(group)
            session.flush()
            for index, value in enumerate(options):
                session.add(SizeOption(group_id=group.id, value=value, sort_order=index))
        session.commit()


def seed_equipment_item_sizes() -> None:
    from app.models import EquipmentItem, SizeGroup

    with SessionLocal() as session:
        groups = {group.name: group for group in session.query(SizeGroup).all()}
        if not groups:
            return
        items = session.query(EquipmentItem).all()
        for item in items:
            if item.available_size_options:
                continue
            lower_name = (item.name or "").lower()
            matched_group_names: list[str] = []
            for keywords, group_names in SIZE_GROUP_KEYWORDS:
                if any(keyword in lower_name for keyword in keywords):
                    matched_group_names = group_names
                    break
            if not matched_group_names:
                matched_group_names = ["Taglia unica"]
            selected_options = []
            for group_name in matched_group_names:
                group = groups.get(group_name)
                if group is not None:
                    selected_options.extend(group.options)
            item.available_size_options = selected_options
        session.commit()


def cleanup_legacy_operational_areas() -> None:
    from app.models import Employee, OperationalArea, TimesheetMapping

    with SessionLocal() as session:
        legacy_area = session.query(OperationalArea).filter(
            OperationalArea.area_code == "VILLAR",
            OperationalArea.name == "Villar",
        ).first()
        if legacy_area is None:
            return

        linked_employee = session.query(Employee).filter(
            Employee.default_operational_area_id == legacy_area.id,
        ).first()
        if linked_employee is not None:
            linked_employee.default_operational_area_id = None

        session.query(TimesheetMapping).filter(
            TimesheetMapping.mapping_type == "cost_center",
            TimesheetMapping.internal_key == legacy_area.area_code,
        ).delete(synchronize_session=False)

        session.delete(legacy_area)
        session.commit()


def cleanup_timesheet_project_configuration() -> None:
    from app.models import LocalProject, TimesheetMapping

    with SessionLocal() as session:
        session.query(TimesheetMapping).filter(
            TimesheetMapping.mapping_type == "project",
        ).delete(synchronize_session=False)
        session.query(LocalProject).delete(synchronize_session=False)
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


ALEMBIC_BASELINE_REVISION = "0001_baseline"


def ensure_alembic_baseline() -> None:
    """Marca i database esistenti alla revisione baseline di Alembic.

    Scrive solo la riga di versione in alembic_version (nessun dato applicativo
    viene toccato): da qui in poi le modifiche di schema passano da
    `alembic revision --autogenerate` + `alembic upgrade head`.
    """
    with engine.begin() as connection:
        connection.execute(text(
            "CREATE TABLE IF NOT EXISTS alembic_version ("
            "version_num VARCHAR(255) NOT NULL, "
            "CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num))"
        ))
        # Le revision id di questo progetto sono slug descrittivi (es.
        # "0005_device_delivery_pending_signature") che superano il VARCHAR(32)
        # di default di Alembic: allarga difensivamente la colonna se la
        # tabella esisteva già con il limite stretto.
        connection.execute(text("ALTER TABLE alembic_version ALTER COLUMN version_num TYPE VARCHAR(255)"))
        existing = connection.execute(text("SELECT version_num FROM alembic_version")).first()
        if existing is None:
            connection.execute(
                text("INSERT INTO alembic_version (version_num) VALUES (:rev)"),
                {"rev": ALEMBIC_BASELINE_REVISION},
            )


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    # Compatibilità deploy per le sole nuove tabelle operative: create_all non
    # aggiunge colonne a tabelle già esistenti.
    from app.services.operational_reporting_schema import ensure_operational_reporting_schema
    ensure_operational_reporting_schema()
    ensure_schema_updates()
    ensure_alembic_baseline()
    seed_operational_areas()
    cleanup_legacy_operational_areas()
    cleanup_timesheet_project_configuration()
    seed_delivery_size_groups()
    seed_equipment_item_sizes()
    seed_portal_user()
    backfill_ldap_employees()
    backfill_timesheet_worker_links()
    seed_org_entities()
    from app.services.org import propagate_org_inheritance
    with SessionLocal() as session:
        propagate_org_inheritance(session)
        session.commit()

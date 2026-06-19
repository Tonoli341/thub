from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Workforce Planner API"
    app_env: str = "development"
    api_v1_prefix: str = "/api"
    database_url: str = "postgresql+psycopg://planner:planner@db:5432/workforce_planner"
    cors_origins: str = "http://localhost:5173,http://localhost,http://127.0.0.1"
    jwt_secret_key: str = "change-this-in-production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 480

    app_username: str = "admin"
    app_password: str = "admin"

    aws_sync_base_url: str = ""
    aws_sync_api_key: str = ""
    aws_sync_users_endpoint: str = "/sync/users"
    aws_sync_timesheets_endpoint: str = "/sync/timesheets"
    aws_sync_interval_minutes: int = 60

    ldap_enabled: bool = True
    ldap_uri: str = ""
    ldap_domain: str = ""
    ldap_user_dn: str = ""
    ldap_group_dn: str = ""
    ldap_allowed_group: str = ""
    ldap_default_role: str = "PLANNER"

    tms_host: str = "192.168.23.52"
    tms_port: int = 1433
    tms_database: str = "SGAM"
    tms_username: str = ""
    tms_password: str = ""
    tms_employee_property_code: str = "02"
    tms_employee_query: str = (
        "SELECT "
        "D.CODICE, "
        "D.COGNOME_NOME, "
        "D.DOMICILIO_TELEFONO, "
        "P.PROPRIETA_CODICE, "
        "COALESCE(M.DESCRIZIONE, 'ALTRO') AS DESCRIZIONE, "
        "D.DATORE_LAVORO, "
        "D.FOTO "
        "FROM T2BaseDipendenti D "
        "LEFT JOIN T2BaseDipendentiProprieta P "
        "ON P.CODICE = D.CODICE "
        "LEFT JOIN T2BaseProprietaDipendenti M "
        "ON M.CODICE = P.PROPRIETA_CODICE "
        "WHERE D.LICENZIATO = 'N'"
    )
    tms_employee_expirations_query: str = (
        "SELECT "
        "S.CODICE, "
        "S.TIPO_SCADENZA, "
        "TS.DESCRIZIONE, "
        "S.DATA_SCADENZA, "
        "S.DATA_RILASCIO, "
        "S.AUTORITA_RILASCIO, "
        "S.NUMERO "
        "FROM T2BaseDipendentiScadenze S "
        "JOIN T2BaseTipiScadenza TS "
        "ON TS.CODICE = S.TIPO_SCADENZA "
        "WHERE S.CODICE = '{employee_code}' "
        "ORDER BY "
        "CASE WHEN S.DATA_SCADENZA IS NULL THEN 1 ELSE 0 END, "
        "S.DATA_SCADENZA ASC, "
        "TS.DESCRIZIONE ASC"
    )

    smtp_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @property
    def cors_origins_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]

    @property
    def resolved_tms_employee_query(self) -> str:
        property_code = self.tms_employee_property_code.replace("'", "''")
        return self.tms_employee_query.format(property_code=property_code)

    def resolve_tms_employee_expirations_query(self, employee_code: str) -> str:
        escaped_employee_code = employee_code.replace("'", "''")
        return self.tms_employee_expirations_query.format(employee_code=escaped_employee_code)

    @property
    def ldap_is_configured(self) -> bool:
        return self.ldap_enabled and bool(self.ldap_uri and self.ldap_domain)

    @property
    def portal_credentials_configured(self) -> bool:
        return bool(self.app_username.strip() and self.app_password)

    @property
    def aws_sync_is_configured(self) -> bool:
        return bool(self.aws_sync_base_url.strip())


settings = Settings()

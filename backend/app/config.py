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

    ldap_enabled: bool = True
    ldap_uri: str = ""
    ldap_domain: str = ""
    ldap_user_dn: str = ""
    ldap_group_dn: str = ""
    ldap_allowed_group: str = ""
    ldap_default_role: str = "PLANNER"
    ldap_service_bind_dn: str = ""
    ldap_service_bind_password: str = ""
    ldap_ad_sync_interval_hours: int = 24

    tms_host: str = "192.168.23.52"
    tms_port: int = 1433
    tms_database: str = "SGAM"
    tms_username: str = ""
    tms_password: str = ""
    tms_employee_property_code: str = "02"
    tms_excluded_employee_ids: str = "178,179,180,181,182"
    tms_employee_query: str = (
        "SELECT "
        "D.CODICE, "
        "D.COGNOME_NOME, "
        "D.DOMICILIO_TELEFONO, "
        "P.PROPRIETA_CODICE, "
        "COALESCE(M.DESCRIZIONE, 'ALTRO') AS DESCRIZIONE, "
        "D.DATORE_LAVORO, "
        "D.DATA_NASCITA, "
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
        "(SELECT MAX(TS.DESCRIZIONE) FROM T2BaseTipiScadenza TS WHERE TS.CODICE = S.TIPO_SCADENZA) AS DESCRIZIONE, "
        "S.DATA_SCADENZA, "
        "S.DATA_RILASCIO, "
        "S.AUTORITA_RILASCIO, "
        "S.NUMERO "
        "FROM T2BaseDipendentiScadenze S "
        "WHERE S.CODICE = '{employee_code}' "
        "ORDER BY "
        "CASE WHEN S.DATA_SCADENZA IS NULL THEN 1 ELSE 0 END, "
        "S.DATA_SCADENZA ASC, "
        "DESCRIZIONE ASC"
    )
    tms_employee_expirations_bulk_query: str = (
        "SELECT "
        "S.CODICE, "
        "S.TIPO_SCADENZA, "
        "(SELECT MAX(TS.DESCRIZIONE) FROM T2BaseTipiScadenza TS WHERE TS.CODICE = S.TIPO_SCADENZA) AS DESCRIZIONE, "
        "S.DATA_SCADENZA, "
        "S.DATA_RILASCIO, "
        "S.AUTORITA_RILASCIO, "
        "S.NUMERO "
        "FROM T2BaseDipendentiScadenze S "
        "WHERE S.CODICE IN ({employee_codes})"
    )
    stocktonoli_host: str = "192.168.23.42"
    stocktonoli_port: int = 1433
    stocktonoli_database: str = "stocktonoli"
    stocktonoli_username: str = ""
    stocktonoli_password: str = ""
    stocktonoli_customer_supplier_query: str = (
        "SELECT BSO_CODSOC, BSO_DESCR "
        "FROM BCCSOCIET "
        "WHERE bso_dtcancellazione IS NULL "
        "ORDER BY BSO_DESCR ASC"
    )
    # Sorgente value-list "liste_aperte" (vedi services/value_list_sources.py).
    # Il %s è bindato da pytds con il codice società dell'incrocio: mai
    # interpolato nella stringa.
    #
    # Aggrega a livello di lista perché la chiave della value-list è
    # sot_numlista: una lista con più ordini deve restare una riga sola.
    # COUNT(DISTINCT sot_numordine) è immune al fan-out del join, mentre
    # COUNT(sor_numordine) conta le righe vere (0 per un ordine senza righe,
    # grazie al LEFT JOIN). Il join include la società: sui numeri ordine non
    # univoci tra società, join sulla sola sot_numordine gonfia num_righe.
    #
    # sot_flchiuso = 0 filtra solo ciò che l'operatore può *scegliere*: le
    # liste chiuse restano in SMGORDTES e la reportistica le interroga senza
    # questo filtro, joinando su (sot_codsoc, sot_numlista) — mai sulla sola
    # numlista, che è univoca solo dentro la società.
    liste_aperte_query: str = (
        "SELECT "
        "sot_numlista, "
        "COUNT(DISTINCT sot_numordine) AS num_ordini, "
        "COUNT(sor_numordine) AS num_righe, "
        "CASE WHEN COUNT(DISTINCT sot_codcli) = 1 "
        "THEN MIN(sot_codcli) ELSE '(vari)' END AS cod_cliente, "
        "CASE WHEN COUNT(DISTINCT sot_codvettore) = 1 "
        "THEN MIN(sot_codvettore) ELSE '(vari)' END AS cod_vettore "
        "FROM SMGORDTES "
        "LEFT JOIN SMGORDRIG "
        "ON sot_codsoc = sor_codsoc "
        "AND sot_numordine = sor_numordine "
        "WHERE sot_flchiuso = 0 "
        "AND sot_flannullato = 0 "
        "AND sot_flbloccato = 0 "
        "AND sot_codsoc = %s "
        "GROUP BY sot_numlista "
        "ORDER BY sot_numlista"
    )

    gesap_base_url: str = "http://192.168.24.21/gesap_dev/sito/api"

    smtp_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""
    smtp_from: str = ""
    public_api_base_url: str = "http://localhost:8088/api"
    # Base URL pubblico del frontend per i link nelle email; se vuoto viene
    # ricavato da public_api_base_url togliendo il suffisso /api.
    public_web_base_url: str = ""
    email_approval_token_expire_minutes: int = 4320
    deliveries_tablet_api_key: str = ""
    deliveries_tablet_label: str = "tablet-consegne"

    ninjaone_base_url: str = "https://eu.ninjarmm.com"
    ninjaone_client_id: str = ""
    ninjaone_client_secret: str = ""
    ninjaone_scope: str = "monitoring"
    # Organizzazione NinjaOne unica su cui T-Hub apre i ticket (services/ninjaone_tickets.py).
    ninjaone_organization_id: str = ""

    # Chiave con cui vengono cifrati i segreti delle integrazioni salvati a
    # database (vedi app/services/crypto.py). Non è una credenziale di un
    # servizio esterno: è la chiave che li protegge, va impostata per ambiente e
    # non va mai cambiata senza reinserire i segreti dalla GUI. Se vuota si
    # ricade sul segreto JWT, così nessun ambiente scrive in chiaro per errore.
    secrets_encryption_key: str = ""

    # NOTA: la configurazione di Microsoft 365 (interruttore generale, credenziali
    # Entra, risposta automatica ferie) non sta più nel `.env`. Vive cifrata a
    # database e si amministra da Configurazione › Integrazioni, spenta di default.

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

    def resolve_tms_employee_expirations_bulk_query(self, employee_codes: list[str]) -> str:
        escaped = ", ".join("'" + code.replace("'", "''") + "'" for code in employee_codes)
        return self.tms_employee_expirations_bulk_query.format(employee_codes=escaped)

    @property
    def tms_excluded_employee_ids_set(self) -> set[str]:
        return {
            item.strip()
            for item in self.tms_excluded_employee_ids.split(",")
            if item.strip()
        }

    @property
    def ldap_is_configured(self) -> bool:
        return self.ldap_enabled and bool(self.ldap_uri and self.ldap_domain)

    @property
    def ldap_service_bind_configured(self) -> bool:
        return self.ldap_is_configured and bool(self.ldap_service_bind_dn.strip() and self.ldap_service_bind_password)

    @property
    def portal_credentials_configured(self) -> bool:
        return bool(self.app_username.strip() and self.app_password)

settings = Settings()

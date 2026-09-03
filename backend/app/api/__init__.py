from fastapi import APIRouter, Depends

from app.api.absence_requests import router as absence_requests_router
from app.api.absence_balances import router as absence_balances_router
from app.api.activity_records import router as activity_records_router
from app.api.areas import router as areas_router
from app.api.assignments import router as assignments_router
from app.api.audit_logs import router as audit_logs_router
from app.api.auth import router as auth_router
from app.api.daily_records import router as daily_records_router
from app.api.deliveries import router as deliveries_router
from app.api.dashboard import router as dashboard_router
from app.api.device_assets import router as device_assets_router
from app.api.device_deliveries import router as device_deliveries_router
from app.api.email_approvals import router as email_approvals_router
from app.api.employees import router as employees_router
from app.api.equipment_items import router as equipment_items_router
from app.api.field_definitions import operator_router as field_definitions_operator_router
from app.api.field_definitions import router as field_definitions_router
from app.api.gesap import router as gesap_router
from app.api.health import router as health_router
from app.api.infinity_billing_customer_supplier_map import router as infinity_billing_customer_supplier_map_router
from app.api.infinity_billing_items import router as infinity_billing_items_router
from app.api.integrations import router as integrations_router
from app.api.justifications import router as justifications_router
from app.api.ldap_employees import router as ldap_employees_router
from app.api.maintenance import router as maintenance_router
from app.api.maintenance_assets import router as maintenance_assets_router
from app.api.maintenance_assets_public import router as maintenance_assets_public_router
from app.api.maintenance_deadlines import router as maintenance_deadlines_router
from app.api.maintenance_documents import router as maintenance_documents_router
from app.api.maintenance_images import router as maintenance_images_router
from app.api.maintenance_notification_rules import router as maintenance_notification_rules_router
from app.api.notifications import router as notifications_router
from app.api.org_entities import router as org_entities_router
from app.api.operational_reporting import router as operational_reporting_router
from app.api.projects import router as projects_router
from app.api.system_status import router as system_status_router
from app.api.teams import router as teams_router
from app.api.timesheets import router as timesheets_router
from app.api.tool_changes import router as tool_changes_router
from app.api.training import courses_router as training_courses_router
from app.api.training import macro_areas_router as training_macro_areas_router
from app.api.training import report_router as training_report_router
from app.api.workloads import router as workloads_router
from app.services.security import get_current_user

api_router = APIRouter()
protected_router = APIRouter(dependencies=[Depends(get_current_user)])

api_router.include_router(health_router)
api_router.include_router(auth_router)
api_router.include_router(activity_records_router)
# Valori delle value-list per la app di rendicontazione: autenticata come
# Employee, quindi fuori da protected_router (che richiede uno User).
api_router.include_router(field_definitions_operator_router)
api_router.include_router(daily_records_router)
api_router.include_router(absence_requests_router)
api_router.include_router(email_approvals_router)
api_router.include_router(deliveries_router)
api_router.include_router(equipment_items_router)
api_router.include_router(device_assets_router)
api_router.include_router(device_deliveries_router)
api_router.include_router(employees_router)
# Pagina pubblica del QR code fisico sull'asset: un tecnico sul campo la apre
# senza login, per token imprevedibile e rigenerabile — nessun dato sensibile
# esposto (niente custom_fields/documenti/immagini, vedi maintenance_assets_public.py).
api_router.include_router(maintenance_assets_public_router)
protected_router.include_router(ldap_employees_router)
protected_router.include_router(maintenance_router)
protected_router.include_router(maintenance_assets_router)
protected_router.include_router(maintenance_documents_router)
protected_router.include_router(maintenance_images_router)
protected_router.include_router(maintenance_deadlines_router)
protected_router.include_router(maintenance_notification_rules_router)
protected_router.include_router(projects_router)
protected_router.include_router(infinity_billing_customer_supplier_map_router)
protected_router.include_router(infinity_billing_items_router)
protected_router.include_router(field_definitions_router)
protected_router.include_router(areas_router)
protected_router.include_router(gesap_router)
protected_router.include_router(audit_logs_router)
protected_router.include_router(system_status_router)
protected_router.include_router(integrations_router)
protected_router.include_router(assignments_router)
protected_router.include_router(justifications_router)
protected_router.include_router(absence_balances_router)
protected_router.include_router(dashboard_router)
protected_router.include_router(teams_router)
protected_router.include_router(tool_changes_router)
protected_router.include_router(timesheets_router)
protected_router.include_router(org_entities_router)
protected_router.include_router(notifications_router)
protected_router.include_router(operational_reporting_router)
protected_router.include_router(workloads_router)
protected_router.include_router(training_macro_areas_router)
protected_router.include_router(training_courses_router)
protected_router.include_router(training_report_router)
api_router.include_router(protected_router)

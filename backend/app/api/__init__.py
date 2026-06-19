from fastapi import APIRouter, Depends

from app.api.areas import router as areas_router
from app.api.assignments import router as assignments_router
from app.api.auth import router as auth_router
from app.api.dashboard import router as dashboard_router
from app.api.employees import router as employees_router
from app.api.justifications import router as justifications_router
from app.api.ldap_employees import router as ldap_employees_router
from app.api.org_entities import router as org_entities_router
from app.api.projects import router as projects_router
from app.api.teams import router as teams_router
from app.api.timesheets import router as timesheets_router
from app.api.tool_changes import router as tool_changes_router
from app.services.security import get_current_user

api_router = APIRouter()
protected_router = APIRouter(dependencies=[Depends(get_current_user)])

api_router.include_router(auth_router)
protected_router.include_router(employees_router)
protected_router.include_router(ldap_employees_router)
protected_router.include_router(projects_router)
protected_router.include_router(areas_router)
protected_router.include_router(assignments_router)
protected_router.include_router(justifications_router)
protected_router.include_router(dashboard_router)
protected_router.include_router(teams_router)
protected_router.include_router(tool_changes_router)
protected_router.include_router(timesheets_router)
protected_router.include_router(org_entities_router)
api_router.include_router(protected_router)

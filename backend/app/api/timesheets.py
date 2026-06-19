from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response, status
from sqlalchemy.orm import Session

from app.db import get_db
from app.enums import UserRole
from app.models import User
from app.schemas import (
    TimesheetAdminOverviewRead,
    TimesheetApproveRequest,
    TimesheetCorrectionRequest,
    TimesheetCostCenterLinkRead,
    TimesheetCostCenterLinkUpdate,
    TimesheetDashboardRead,
    TimesheetDayListRead,
    TimesheetDetailRead,
    TimesheetFiltersRead,
    TimesheetManualUpdate,
    TimesheetMappingCreate,
    TimesheetMappingRead,
    TimesheetMappingUpdate,
    TimesheetProjectLinkRead,
    TimesheetProjectLinkUpdate,
    TimesheetStatsRead,
    TimesheetSyncRunRead,
    TimesheetWorkerLinkRead,
    TimesheetWorkerLinkUpdate,
)
from app.services.portal_auth import build_auth_user_read
from app.services.security import get_current_user
from app.services.timesheets import (
    approve_timesheet_day,
    build_admin_overview,
    build_timesheet_dashboard,
    build_timesheet_stats,
    build_timesheet_detail,
    build_timesheet_filters,
    build_timesheets_csv,
    create_mapping,
    delete_mapping,
    delete_worker,
    list_mappings_payload,
    list_project_links_payload,
    list_sync_runs_payload,
    list_timesheet_days_payload,
    list_cost_center_links_payload,
    list_worker_links_payload,
    manual_update_timesheet_day,
    request_timesheet_correction,
    sync_timesheets,
    upsert_project_link,
    upsert_cost_center_link,
    update_worker_link,
    update_mapping,
)

router = APIRouter(prefix="/timesheets", tags=["timesheets"])


def require_timesheets_access(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)) -> User:
    auth_user = build_auth_user_read(db, current_user)
    if not auth_user.can_access_timesheets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accesso rendicontazioni non consentito.")
    return current_user


def require_timesheets_admin(current_user: User = Depends(require_timesheets_access)) -> User:
    if current_user.role != UserRole.admin:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Area amministrativa non consentita.")
    return current_user


@router.get("/dashboard", response_model=TimesheetDashboardRead)
def dashboard(day: date = Query(...), db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    return build_timesheet_dashboard(db, day)


@router.get("/stats", response_model=TimesheetStatsRead)
def stats(start: date = Query(...), end: date = Query(...), db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    return build_timesheet_stats(db, start=start, end=end)


@router.get("/filters", response_model=TimesheetFiltersRead)
def filters(start: date | None = Query(default=None), end: date | None = Query(default=None), db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    return build_timesheet_filters(db, start=start, end=end)


@router.get("", response_model=list[TimesheetDayListRead])
def list_timesheets(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    worker_id: str | None = Query(default=None),
    department: str | None = Query(default=None),
    project: str | None = Query(default=None),
    cost_center: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    approval_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_access),
) -> list[dict]:
    return list_timesheet_days_payload(db, start=start, end=end, worker_id=worker_id, department=department, project=project, cost_center=cost_center, status=status_filter, approval_status=approval_status, search=search)


@router.get("/export")
def export_timesheets(
    start: date | None = Query(default=None),
    end: date | None = Query(default=None),
    worker_id: str | None = Query(default=None),
    department: str | None = Query(default=None),
    project: str | None = Query(default=None),
    cost_center: str | None = Query(default=None),
    status_filter: str | None = Query(default=None, alias="status"),
    approval_status: str | None = Query(default=None),
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_access),
) -> Response:
    csv_payload = build_timesheets_csv(db, start=start, end=end, worker_id=worker_id, department=department, project=project, cost_center=cost_center, status=status_filter, approval_status=approval_status, search=search)
    return Response(content=csv_payload, media_type="text/csv", headers={"Content-Disposition": "attachment; filename=timesheets.csv"})


@router.get("/admin/overview", response_model=TimesheetAdminOverviewRead)
def admin_overview(db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> dict:
    return build_admin_overview(db)


@router.get("/admin/sync-runs", response_model=list[TimesheetSyncRunRead])
def sync_runs(db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> list[dict]:
    return list_sync_runs_payload(db)


@router.get("/admin/workers", response_model=list[TimesheetWorkerLinkRead])
def worker_links(
    search: str | None = Query(default=None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> list[dict]:
    return list_worker_links_payload(db, search)


@router.post("/admin/sync", response_model=TimesheetSyncRunRead)
def manual_sync(db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> dict:
    try:
        return sync_timesheets(db, trigger_source="manual", actor_name=current_user.username, user_id=current_user.id)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.patch("/admin/workers/{worker_id}/employee-link", response_model=TimesheetWorkerLinkRead)
def update_worker_employee_link(
    worker_id: str,
    payload: TimesheetWorkerLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> dict:
    try:
        updated = update_worker_link(db, worker_id, payload.tms_employee_id, current_user)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operatore AWS non trovato.")
    return updated


@router.delete("/admin/workers/{worker_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_worker_endpoint(
    worker_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> Response:
    deleted = delete_worker(db, worker_id, current_user)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Operatore AWS non trovato.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/admin/projects", response_model=list[TimesheetProjectLinkRead])
def list_project_links(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> list[dict]:
    return list_project_links_payload(db)


@router.patch("/admin/projects/{external_key}", response_model=TimesheetProjectLinkRead)
def update_project_link(
    external_key: str,
    payload: TimesheetProjectLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> dict:
    try:
        return upsert_project_link(db, external_key, payload.local_project_id, current_user)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/admin/cost-centers", response_model=list[TimesheetCostCenterLinkRead])
def list_cost_center_links(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> list[dict]:
    return list_cost_center_links_payload(db)


@router.patch("/admin/cost-centers/{external_key}", response_model=TimesheetCostCenterLinkRead)
def update_cost_center_link(
    external_key: str,
    payload: TimesheetCostCenterLinkUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_timesheets_admin),
) -> dict:
    try:
        return upsert_cost_center_link(db, external_key, payload.operational_area_code, current_user)
    except RuntimeError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc


@router.get("/admin/mappings", response_model=list[TimesheetMappingRead])
def list_mappings(mapping_type: str | None = Query(default=None), db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> list[dict]:
    return list_mappings_payload(db, mapping_type)


@router.post("/admin/mappings", response_model=TimesheetMappingRead, status_code=status.HTTP_201_CREATED)
def create_mapping_endpoint(payload: TimesheetMappingCreate, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> dict:
    return create_mapping(db, payload.model_dump(), current_user)


@router.put("/admin/mappings/{mapping_id}", response_model=TimesheetMappingRead)
def update_mapping_endpoint(mapping_id: str, payload: TimesheetMappingUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> dict:
    updated = update_mapping(db, mapping_id, payload.model_dump(exclude_unset=True), current_user)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping non trovato.")
    return updated


@router.delete("/admin/mappings/{mapping_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_mapping_endpoint(mapping_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_admin)) -> Response:
    deleted = delete_mapping(db, mapping_id, current_user)
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Mapping non trovato.")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/{day_id}", response_model=TimesheetDetailRead)
def detail(day_id: str, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    payload = build_timesheet_detail(db, day_id)
    if payload is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rendicontazione non trovata.")
    return payload


@router.patch("/{day_id}/approve", response_model=TimesheetDetailRead)
def approve(day_id: str, payload: TimesheetApproveRequest, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    updated = approve_timesheet_day(db, day_id, current_user, payload.note)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rendicontazione non trovata.")
    return updated


@router.patch("/{day_id}/request-correction", response_model=TimesheetDetailRead)
def request_correction(day_id: str, payload: TimesheetCorrectionRequest, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    updated = request_timesheet_correction(db, day_id, current_user, payload.note)
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rendicontazione non trovata.")
    return updated


@router.put("/{day_id}/manual-update", response_model=TimesheetDetailRead)
def manual_update(day_id: str, payload: TimesheetManualUpdate, db: Session = Depends(get_db), current_user: User = Depends(require_timesheets_access)) -> dict:
    updated = manual_update_timesheet_day(db, day_id, current_user, payload.model_dump())
    if updated is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Rendicontazione non trovata.")
    return updated

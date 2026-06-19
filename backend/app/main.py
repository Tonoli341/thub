from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.config import settings
from app.db import init_db
from app.services.timesheets import start_timesheet_sync_scheduler, stop_timesheet_sync_scheduler

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def on_startup() -> None:
    init_db()
    start_timesheet_sync_scheduler()


@app.on_event("shutdown")
def on_shutdown() -> None:
    stop_timesheet_sync_scheduler()


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok", "app": settings.app_name, "env": settings.app_env}


@app.get("/")
def root() -> dict[str, str]:
    return {"message": settings.app_name}


app.include_router(api_router, prefix=settings.api_v1_prefix)

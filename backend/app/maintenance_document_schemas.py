from datetime import datetime

from pydantic import BaseModel, Field

from app.enums import MaintenanceDocumentStatus


class MaintenanceDocumentRead(BaseModel):
    id: str
    asset_id: str
    doc_type: str
    title: str
    is_photo: bool
    status: MaintenanceDocumentStatus
    original_filename: str
    mime_type: str
    size_bytes: int
    uploaded_by: str | None
    created_at: datetime


class MaintenanceDocumentDelete(BaseModel):
    reason: str = Field(min_length=1, max_length=500)


class MaintenanceDocumentStatusUpdate(BaseModel):
    status: MaintenanceDocumentStatus

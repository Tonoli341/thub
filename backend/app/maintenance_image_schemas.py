from datetime import datetime

from pydantic import BaseModel, Field


class MaintenanceAssetImageRead(BaseModel):
    id: str
    asset_id: str
    image_kind: str
    slot_key: str
    title: str
    original_filename: str
    mime_type: str
    size_bytes: int
    uploaded_by: str | None
    created_at: datetime
    updated_at: datetime


class MaintenanceAssetImageDelete(BaseModel):
    reason: str = Field(min_length=1, max_length=500)

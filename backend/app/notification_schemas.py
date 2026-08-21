from datetime import datetime

from pydantic import BaseModel


class NotificationRead(BaseModel):
    id: str
    category: str
    title: str
    message: str
    detail: str | None = None
    href: str
    created_at: datetime | None = None

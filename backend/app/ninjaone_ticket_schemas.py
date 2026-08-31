from pydantic import BaseModel, Field


class NinjaOneTicketRead(BaseModel):
    id: str
    ninja_ticket_id: str
    subject: str
    description: str
    priority: str
    status: str
    requested_by_id: str
    requested_by_name: str
    created_at: str


class NinjaOneTicketCreate(BaseModel):
    subject: str = Field(min_length=1, max_length=255)
    description: str = Field(min_length=1)
    priority: str = Field(default="NORMAL")

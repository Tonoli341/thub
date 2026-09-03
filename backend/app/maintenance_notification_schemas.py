from pydantic import BaseModel, Field


class MaintenanceNotificationRuleRead(BaseModel):
    id: str
    asset_class_id: str | None
    asset_class_label: str | None
    site: str | None
    recipient_ldap_employee_ids: list[str]
    recipient_labels: list[str]
    is_active: bool


class MaintenanceNotificationRuleCreate(BaseModel):
    asset_class_id: str | None = None
    site: str | None = Field(default=None, max_length=120)
    recipient_ldap_employee_ids: list[str] = Field(default_factory=list)
    is_active: bool = True


class MaintenanceNotificationRuleUpdate(BaseModel):
    asset_class_id: str | None = None
    site: str | None = Field(default=None, max_length=120)
    recipient_ldap_employee_ids: list[str] | None = None
    is_active: bool | None = None

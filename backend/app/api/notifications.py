from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_impersonation_employee
from app.db import get_db
from app.models import Employee, User
from app.notification_schemas import NotificationRead
from app.services.notifications import build_notifications
from app.services.security import get_current_user


router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationRead])
def list_notifications(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
    impersonate_employee: Employee | None = Depends(get_impersonation_employee),
) -> list[dict]:
    return build_notifications(db, current_user, target_employee=impersonate_employee)

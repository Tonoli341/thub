from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import require_maintenance_access
from app.db import get_db
from app.maintenance_questionnaire_schemas import MaintenanceQuestionnaireRead, MaintenanceQuestionnaireUpdate
from app.models import User
from app.services.maintenance_questionnaire import read_questionnaire, save_questionnaire


router = APIRouter(
    prefix="/maintenance",
    tags=["maintenance"],
)


@router.get("/questionnaire", response_model=MaintenanceQuestionnaireRead)
def get_maintenance_questionnaire(
    db: Session = Depends(get_db),
    _: User = Depends(require_maintenance_access),
) -> dict:
    return read_questionnaire(db)


@router.put("/questionnaire", response_model=MaintenanceQuestionnaireRead)
def update_maintenance_questionnaire(
    payload: MaintenanceQuestionnaireUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_maintenance_access),
) -> dict:
    return save_questionnaire(
        db,
        answers=payload.answers,
        expected_version=payload.version,
        current_user=current_user,
    )

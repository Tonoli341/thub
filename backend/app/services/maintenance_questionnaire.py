from sqlalchemy.orm import Session

from app.maintenance_models import MaintenanceQuestionnaire
from app.models import User
from app.services.audit import record_audit_log
from app.services.errors import DomainError


QUESTIONNAIRE_ID = "maintenance-discovery"


def read_questionnaire(db: Session) -> dict:
    questionnaire = db.get(MaintenanceQuestionnaire, QUESTIONNAIRE_ID)
    if questionnaire is None:
        return {"answers": {}, "version": 0, "updated_at": None, "updated_by": None}
    return {
        "answers": questionnaire.answers or {},
        "version": questionnaire.version,
        "updated_at": questionnaire.updated_at,
        "updated_by": questionnaire.updated_by,
    }


def save_questionnaire(
    db: Session,
    *,
    answers: dict,
    expected_version: int,
    current_user: User,
) -> dict:
    questionnaire = db.get(MaintenanceQuestionnaire, QUESTIONNAIRE_ID)
    current_version = questionnaire.version if questionnaire else 0
    if expected_version != current_version:
        raise DomainError(
            "Il questionario è stato aggiornato da un altro utente. Ricarica la pagina prima di salvare."
        )

    if questionnaire is None:
        questionnaire = MaintenanceQuestionnaire(
            id=QUESTIONNAIRE_ID,
            answers=answers,
            version=1,
            updated_by=current_user.display_name or current_user.username,
        )
        db.add(questionnaire)
    else:
        questionnaire.answers = answers
        questionnaire.version += 1
        questionnaire.updated_by = current_user.display_name or current_user.username

    record_audit_log(
        db,
        action="update",
        entity="maintenance_questionnaire",
        actor_name=current_user.username,
        user_id=current_user.id,
        detail={
            "questionnaire_id": QUESTIONNAIRE_ID,
            "version": questionnaire.version,
            "answered_fields": sum(bool(value) for value in answers.values()),
        },
    )
    db.commit()
    db.refresh(questionnaire)
    return read_questionnaire(db)

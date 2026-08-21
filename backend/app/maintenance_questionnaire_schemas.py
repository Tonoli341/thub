from datetime import datetime

from pydantic import BaseModel, Field, field_validator


AnswerValue = str | list[str]


class MaintenanceQuestionnaireUpdate(BaseModel):
    version: int = Field(ge=0)
    answers: dict[str, AnswerValue]

    @field_validator("answers")
    @classmethod
    def validate_answers(cls, answers: dict[str, AnswerValue]) -> dict[str, AnswerValue]:
        if len(answers) > 300:
            raise ValueError("Il questionario contiene troppe risposte.")
        for key, value in answers.items():
            if not key or len(key) > 80 or any(char not in "abcdefghijklmnopqrstuvwxyz0123456789_.-" for char in key):
                raise ValueError("Identificativo domanda non valido.")
            values = value if isinstance(value, list) else [value]
            if len(values) > 50 or any(len(item) > 10_000 for item in values):
                raise ValueError("Una risposta supera i limiti consentiti.")
        return answers


class MaintenanceQuestionnaireRead(BaseModel):
    answers: dict[str, AnswerValue] = Field(default_factory=dict)
    version: int = 0
    updated_at: datetime | None = None
    updated_by: str | None = None

import re


def normalize_phone(value: str | None) -> str | None:
    if value is None:
        return None

    stripped = value.strip()
    if not stripped:
        return None

    digits = re.sub(r"\D+", "", stripped)
    if not digits:
        return None

    if stripped.startswith("+"):
        return f"+{digits}"
    return digits

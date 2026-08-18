import re


def building_codes(entries: list | None, *, visibility: str | None = None) -> list[str]:
    """Estrae i codici immobile da `OperationalArea.buildings`, che può contenere
    stringhe (formato storico) o oggetti {code, visible_in_planner, visible_in_reporting}.
    `visibility` filtra sul flag indicato ("visible_in_planner" o "visible_in_reporting");
    le stringhe legacy sono considerate sempre visibili."""
    codes: list[str] = []
    for entry in entries or []:
        if isinstance(entry, str):
            code = entry.strip().upper()
        else:
            if visibility is not None and not entry.get(visibility, True):
                continue
            code = str(entry.get("code") or "").strip().upper()
        if code and code not in codes:
            codes.append(code)
    return codes


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

// Helper per il campo `buildings` delle aree operative.
// Il backend può restituire stringhe (formato storico) o oggetti
// { code, visible_in_planner, visible_in_reporting }.

export function normalizeBuilding(entry) {
  if (typeof entry === "string") {
    return { code: entry.trim().toUpperCase(), visible_in_planner: true, visible_in_reporting: true };
  }
  return {
    code: String(entry?.code ?? "").trim().toUpperCase(),
    visible_in_planner: entry?.visible_in_planner ?? true,
    visible_in_reporting: entry?.visible_in_reporting ?? true,
  };
}

export function normalizeBuildings(entries) {
  return (entries ?? []).map(normalizeBuilding).filter((b) => b.code);
}

// Codici immobile visibili nel Planner.
export function plannerBuildingCodes(entries) {
  return normalizeBuildings(entries)
    .filter((b) => b.visible_in_planner)
    .map((b) => b.code);
}

// Codici immobile utilizzabili in rendicontazione.
export function reportingBuildingCodes(entries) {
  return normalizeBuildings(entries)
    .filter((b) => b.visible_in_reporting)
    .map((b) => b.code);
}

// Tutti i codici immobile, senza filtro di visibilità.
export function allBuildingCodes(entries) {
  return normalizeBuildings(entries).map((b) => b.code);
}

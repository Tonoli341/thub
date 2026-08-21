// Colonne della tabella Presenze. Le percentuali devono sommare a 100 in
// entrambe le varianti: la colonna Azioni compare solo agli admin.
const BASE = [
  { key: "employee", label: "Dipendente", width: 14, adminWidth: 13 },
  { key: "date", label: "Data", width: 8, adminWidth: 7 },
  { key: "start", label: "Inizio", width: 6, adminWidth: 5 },
  { key: "end", label: "Fine", width: 6, adminWidth: 5 },
  { key: "area", label: "Area", width: 10, adminWidth: 9 },
  { key: "building", label: "Immobile", width: 10, adminWidth: 9 },
  { key: "pauses", label: "Pause", width: 13, adminWidth: 12 },
  { key: "pauseTime", label: "T. pausa", width: 6, adminWidth: 6 },
  { key: "standard", label: "T. standard", width: 7, adminWidth: 7 },
  { key: "work", label: "T. lavoro", width: 7, adminWidth: 7 },
  { key: "overtime", label: "Straord.", width: 7, adminWidth: 7 },
  { key: "created", label: "Creato il", width: 6, adminWidth: 6 },
];

export function dailyRecordsColumns(isAdmin) {
  const columns = BASE.map((column) => ({
    key: column.key,
    label: column.label,
    width: isAdmin ? column.adminWidth : column.width,
  }));
  return isAdmin ? [...columns, { key: "actions", label: "Azioni", width: 7 }] : columns;
}

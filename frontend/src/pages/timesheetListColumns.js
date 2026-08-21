// Colonne dell'elenco Giornate. La colonna Azioni compare solo agli admin.
const BASE = [
  { key: "employee", label: "Dipendente", width: 15, adminWidth: 14 },
  { key: "project", label: "Commessa", width: 14, adminWidth: 13 },
  { key: "area", label: "Area", width: 12, adminWidth: 11 },
  { key: "building", label: "Immobile", width: 12, adminWidth: 11 },
  { key: "date", label: "Data", width: 9, adminWidth: 8 },
  { key: "start", label: "Inizio", width: 8, adminWidth: 7 },
  { key: "end", label: "Fine", width: 8, adminWidth: 7 },
  { key: "duration", label: "Durata", width: 10, adminWidth: 9 },
  { key: "fields", label: "Campi", width: 12, adminWidth: 11 },
];

export function timesheetListColumns(isAdmin) {
  const columns = BASE.map((column) => ({
    key: column.key,
    label: column.label,
    width: isAdmin ? column.adminWidth : column.width,
  }));
  return isAdmin ? [...columns, { key: "actions", label: "Azioni", width: 9 }] : columns;
}

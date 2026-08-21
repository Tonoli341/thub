// Colonne dei timer attivi. La colonna Azioni compare solo agli admin: entrambe
// le varianti devono sommare a 100 (vedi components/tableStyles.js).
const BASE = [
  { key: "employee", label: "Dipendente", width: 18, adminWidth: 16 },
  { key: "mapping", label: "Incrocio", width: 18, adminWidth: 16 },
  { key: "area", label: "Area / Immobile", width: 18, adminWidth: 16 },
  { key: "start", label: "Inizio", width: 11, adminWidth: 10 },
  { key: "state", label: "Stato", width: 11, adminWidth: 10 },
  { key: "elapsed", label: "Trascorso", width: 11, adminWidth: 10 },
  { key: "heartbeat", label: "Ultimo heartbeat", width: 13, adminWidth: 12 },
];

export function activeActivitiesColumns(isAdmin) {
  const columns = BASE.map((column) => ({
    key: column.key,
    label: column.label,
    width: isAdmin ? column.adminWidth : column.width,
  }));
  return isAdmin ? [...columns, { key: "actions", label: "Azioni", width: 10 }] : columns;
}

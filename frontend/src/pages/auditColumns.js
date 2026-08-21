// Colonne della tabella Audit: percentuali che sommano a 100 (vedi tableStyles.js).
export const AUDIT_COLUMNS = [
  { key: "timestamp", label: "Data e ora", width: 20 },
  { key: "actor", label: "Utente", width: 24 },
  { key: "action", label: "Azione", width: 20 },
  { key: "entity", label: "Entità", width: 26 },
  { key: "detail", label: "Dettaglio", width: 10, align: "right" },
];

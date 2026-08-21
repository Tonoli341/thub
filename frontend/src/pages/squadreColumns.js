import { totalColumnWidth } from "../components/tableStyles.js";

// Colonne della tabella Squadre. Le percentuali devono sommare a 100: è
// l'invariante che tiene in piedi il layout fisso (vedi components/tableStyles.js).
export const SQUADRE_COLUMNS = [
  { key: "team", label: "Squadra", width: 18 },
  { key: "leader1", label: "Team leader 1", width: 15 },
  { key: "leader2", label: "Team leader 2", width: 15 },
  { key: "workload", label: "Owner carichi", width: 15 },
  { key: "reporting", label: "Owner rendicontazione", width: 19 },
  { key: "members", label: "Membri", width: 8, align: "center" },
  { key: "updated", label: "Ultima modifica", width: 10 },
];

export { totalColumnWidth };

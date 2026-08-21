import { totalColumnWidth } from "../components/tableStyles.js";

// Colonne della tabella Dipendenti. Le percentuali devono sommare a 100 in
// entrambe le varianti — la colonna "impersona" esiste solo per chi può
// impersonare (vedi components/tableStyles.js).
//
// "Dipendente" è la colonna identificativa e si prende la fetta più larga: i
// nomi lunghi devono restare leggibili per intero. Lo spazio arriva da "Ruolo"
// e "Ruolo portale", ridotte alla sola icona con il testo nel tooltip.
export function employeesColumns({ withImpersonate = false } = {}) {
  return [
    { key: "employee", label: "Dipendente", width: withImpersonate ? 30 : 33 },
    { key: "role", label: "Ruolo", width: 7, align: "center" },
    { key: "portalRole", label: "Ruolo portale", width: 8, align: "center" },
    { key: "area", label: "Area", width: 7 },
    { key: "employer", label: "Datore di lavoro", width: 18 },
    { key: "manager", label: "Responsabile", width: withImpersonate ? 17 : 19 },
    { key: "status", label: "Stato", width: 8 },
    ...(withImpersonate ? [{ key: "impersonate", label: "", width: 5, align: "center" }] : []),
  ];
}

export { totalColumnWidth };

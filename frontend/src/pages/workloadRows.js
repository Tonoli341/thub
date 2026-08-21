const CANCELLED_GESAP_STATUSES = new Set([
  "ANNULLATO",
  "ANNULLATA",
  "CANCELLATO",
  "CANCELLATA",
  "ELIMINATO",
  "ELIMINATA",
]);

export function isGesapWorkloadRow(row) {
  return Boolean(row?.gesap_booking_id);
}

export function isCancelledGesapBooking(item) {
  return CANCELLED_GESAP_STATUSES.has(String(item?.stato ?? "").trim().toUpperCase());
}

export function workloadCustomerLabel(row) {
  return row?.customer_name || row?.client_supplier || row?.client_supplier_code || "";
}

export function workloadSupplierLabel(row) {
  return row?.supplier_name || "";
}

// Chiave delle righe di carico prive di magazzino: nel riepilogo Planner per
// Area/Immobile finiscono in un blocco a parte invece di sparire.
export const WORKLOAD_NO_WAREHOUSE_KEY = "SENZA MAGAZZINO";

// La colonna "Mag" contiene nomi di aree operative, anche più di uno separato
// da virgola (vedi WorkloadPage): qui si normalizzano per il confronto.
export function parseWorkloadWarehouses(value) {
  return [...new Set(
    String(value ?? "")
      .split(",")
      .map((item) => item.trim().toUpperCase())
      .filter(Boolean),
  )];
}

// Ridistribuisce le righe di carico delle squadre sulle aree indicate in "Mag".
// Una riga con più aree compare sotto ciascuna: è lo stesso lavoro visto da
// aree diverse, non un doppio conteggio di squadra.
export function groupWorkloadRowsByArea(notes, { teamIds = null } = {}) {
  const map = {};
  for (const note of notes ?? []) {
    if (teamIds && !teamIds.includes(note?.team_id)) continue;
    for (const row of note?.rows ?? note?.table_rows ?? []) {
      const areaKeys = parseWorkloadWarehouses(row?.warehouse);
      for (const key of areaKeys.length > 0 ? areaKeys : [WORKLOAD_NO_WAREHOUSE_KEY]) {
        if (!map[key]) map[key] = [];
        map[key].push(row);
      }
    }
  }
  return map;
}

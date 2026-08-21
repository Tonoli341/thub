import assert from "node:assert/strict";
import test from "node:test";

import {
  WORKLOAD_NO_WAREHOUSE_KEY,
  groupWorkloadRowsByArea,
  isCancelledGesapBooking,
  isGesapWorkloadRow,
  parseWorkloadWarehouses,
  workloadCustomerLabel,
  workloadSupplierLabel,
} from "./workloadRows.js";

test("riconosce righe e stati ToolTo", () => {
  assert.equal(isGesapWorkloadRow({ gesap_booking_id: "215" }), true);
  assert.equal(isGesapWorkloadRow({ client_supplier: "Manuale" }), false);
  assert.equal(isCancelledGesapBooking({ stato: "annullato" }), true);
  assert.equal(isCancelledGesapBooking({ stato: "PRENOTATO" }), false);
});

test("mostra cliente e fornitore separati mantenendo il formato storico", () => {
  assert.equal(workloadCustomerLabel({ customer_name: "Cliente", client_supplier: "Storico" }), "Cliente");
  assert.equal(workloadSupplierLabel({ supplier_name: "Fornitore" }), "Fornitore");
  assert.equal(workloadCustomerLabel({ client_supplier: "Riga manuale" }), "Riga manuale");
});

test("normalizza la colonna Mag in chiavi di area", () => {
  assert.deepEqual(parseWorkloadWarehouses(" magazzino a , Magazzino B "), ["MAGAZZINO A", "MAGAZZINO B"]);
  assert.deepEqual(parseWorkloadWarehouses("Area, area"), ["AREA"]);
  assert.deepEqual(parseWorkloadWarehouses(null), []);
});

test("raggruppa il carico di lavoro per area, con blocco per le righe senza Mag", () => {
  const notes = [
    { team_id: "t1", rows: [
      { row_id: "r1", warehouse: "Magazzino A, Magazzino B", inbound_count: 2 },
      { row_id: "r2", warehouse: "", inbound_count: 1 },
    ] },
    { team_id: "t2", table_rows: [{ row_id: "r3", warehouse: "magazzino a" }] },
  ];

  const grouped = groupWorkloadRowsByArea(notes);
  assert.deepEqual(grouped["MAGAZZINO A"].map((row) => row.row_id), ["r1", "r3"]);
  assert.deepEqual(grouped["MAGAZZINO B"].map((row) => row.row_id), ["r1"]);
  assert.deepEqual(grouped[WORKLOAD_NO_WAREHOUSE_KEY].map((row) => row.row_id), ["r2"]);

  // Il filtro per squadra del riepilogo restringe anche il carico di lavoro.
  const onlyTeam1 = groupWorkloadRowsByArea(notes, { teamIds: ["t1"] });
  assert.deepEqual(onlyTeam1["MAGAZZINO A"].map((row) => row.row_id), ["r1"]);
  assert.equal(groupWorkloadRowsByArea([], { teamIds: ["t1"] })["MAGAZZINO A"], undefined);
});

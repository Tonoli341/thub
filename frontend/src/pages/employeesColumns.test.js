import test from "node:test";
import assert from "node:assert/strict";

import { employeesColumns, totalColumnWidth } from "./employeesColumns.js";

test("le larghezze coprono esattamente la tabella, con e senza impersonificazione", () => {
  assert.equal(totalColumnWidth(employeesColumns()), 100);
  assert.equal(totalColumnWidth(employeesColumns({ withImpersonate: true })), 100);
});

test("la colonna del dipendente resta la più larga", () => {
  for (const withImpersonate of [false, true]) {
    const columns = employeesColumns({ withImpersonate });
    const widest = columns.reduce((max, column) => (column.width > max.width ? column : max));
    assert.equal(widest.key, "employee", `colonna più larga inattesa (impersona: ${withImpersonate})`);
  }
});

test("ogni colonna ha chiave univoca e larghezza valida", () => {
  const columns = employeesColumns({ withImpersonate: true });
  const keys = columns.map((column) => column.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const column of columns) {
    assert.ok(column.width > 0, `larghezza non valida per ${column.key}`);
    assert.equal(typeof column.label, "string", `etichetta mancante per ${column.key}`);
  }
});

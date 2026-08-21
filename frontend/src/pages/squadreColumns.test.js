import test from "node:test";
import assert from "node:assert/strict";

import { SQUADRE_COLUMNS, totalColumnWidth } from "./squadreColumns.js";

test("le larghezze delle colonne coprono esattamente la tabella", () => {
  assert.equal(totalColumnWidth(SQUADRE_COLUMNS), 100);
});

test("ogni colonna ha chiave univoca ed etichetta", () => {
  const keys = SQUADRE_COLUMNS.map((column) => column.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const column of SQUADRE_COLUMNS) {
    assert.ok(column.label.trim().length > 0, `etichetta mancante per ${column.key}`);
    assert.ok(column.width > 0, `larghezza non valida per ${column.key}`);
  }
});

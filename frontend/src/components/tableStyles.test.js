import test from "node:test";
import assert from "node:assert/strict";

import { bodyRowSx, tableSx, totalColumnWidth } from "./tableStyles.js";

test("le percentuali di colonna devono coprire esattamente la tabella", () => {
  assert.equal(totalColumnWidth([{ width: 60 }, { width: 40 }]), 100);
  assert.notEqual(totalColumnWidth([{ width: 60 }, { width: 50 }]), 100);
});

test("le tabelle usano il layout fisso, che è ciò che le rende adattive", () => {
  assert.equal(tableSx().tableLayout, "fixed");
  assert.equal(tableSx().minWidth, 720);
  assert.equal(tableSx({ minWidth: 900 }).minWidth, 900);
});

test("la riga cliccabile si distingue solo per il cursore", () => {
  assert.equal(bodyRowSx().cursor, undefined);
  assert.equal(bodyRowSx({ clickable: true }).cursor, "pointer");
});

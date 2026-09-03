import test from "node:test";
import assert from "node:assert/strict";

import { totalColumnWidth } from "../components/tableStyles.js";
import { MAINTENANCE_ASSETS_COLUMNS } from "./maintenanceAssetsColumns.js";

test("le colonne del registro asset coprono esattamente la tabella", () => {
  assert.equal(totalColumnWidth(MAINTENANCE_ASSETS_COLUMNS), 100);
});

test("l'identità dell'asset resta la colonna principale", () => {
  const widest = MAINTENANCE_ASSETS_COLUMNS.reduce((current, column) => (
    column.width > current.width ? column : current
  ));
  assert.equal(widest.key, "asset");
});

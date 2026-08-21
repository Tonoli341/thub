import test from "node:test";
import assert from "node:assert/strict";

import { totalColumnWidth } from "../components/tableStyles.js";
import { dailyRecordsColumns } from "./dailyRecordsColumns.js";

test("le colonne delle presenze coprono la tabella con e senza la colonna Azioni", () => {
  assert.equal(totalColumnWidth(dailyRecordsColumns(false)), 100);
  assert.equal(totalColumnWidth(dailyRecordsColumns(true)), 100);
});

test("la colonna Azioni compare solo agli admin", () => {
  assert.equal(dailyRecordsColumns(false).some((c) => c.key === "actions"), false);
  assert.equal(dailyRecordsColumns(true).at(-1).key, "actions");
});

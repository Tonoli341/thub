import test from "node:test";
import assert from "node:assert/strict";

import { totalColumnWidth } from "../components/tableStyles.js";
import { timesheetListColumns } from "./timesheetListColumns.js";

test("le colonne delle giornate coprono la tabella con e senza Azioni", () => {
  assert.equal(totalColumnWidth(timesheetListColumns(false)), 100);
  assert.equal(totalColumnWidth(timesheetListColumns(true)), 100);
});

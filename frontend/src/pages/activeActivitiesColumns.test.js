import test from "node:test";
import assert from "node:assert/strict";

import { totalColumnWidth } from "../components/tableStyles.js";
import { activeActivitiesColumns } from "./activeActivitiesColumns.js";

test("le colonne dei timer attivi coprono la tabella con e senza Azioni", () => {
  assert.equal(totalColumnWidth(activeActivitiesColumns(false)), 100);
  assert.equal(totalColumnWidth(activeActivitiesColumns(true)), 100);
});

import test from "node:test";
import assert from "node:assert/strict";

import { totalColumnWidth } from "../components/tableStyles.js";
import { AUDIT_COLUMNS } from "./auditColumns.js";

test("le colonne dell'audit coprono esattamente la tabella", () => {
  assert.equal(totalColumnWidth(AUDIT_COLUMNS), 100);
});

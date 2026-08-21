import test from "node:test";
import assert from "node:assert/strict";

import { totalColumnWidth } from "../components/tableStyles.js";
import { LDAP_COLUMNS } from "./ldapColumns.js";

test("le colonne del mapping LDAP coprono esattamente la tabella", () => {
  assert.equal(totalColumnWidth(LDAP_COLUMNS), 100);
});

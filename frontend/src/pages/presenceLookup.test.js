import test from "node:test";
import assert from "node:assert/strict";

import { absenceWindowLabel } from "./presenceLookup.js";

test("una finestra su più giorni si legge dal ... al ...", () => {
  assert.equal(absenceWindowLabel("05/08–07/08"), "dal 05/08 al 07/08");
});

test("una finestra di un giorno solo non si ripete", () => {
  assert.equal(absenceWindowLabel("05/08–05/08"), "il 05/08");
});

test("un formato inatteso viene restituito così com'è", () => {
  assert.equal(absenceWindowLabel("05/08"), "05/08");
  assert.equal(absenceWindowLabel(""), "");
  assert.equal(absenceWindowLabel(null), null);
});

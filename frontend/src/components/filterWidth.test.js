import test from "node:test";
import assert from "node:assert/strict";

import { FILTER_MAX_PX, FILTER_MIN_PX, filterBasis } from "./filterWidth.js";

test("le opzioni corte non restringono il filtro sotto il minimo", () => {
  assert.equal(filterBasis(["Sì", "No"]), FILTER_MIN_PX);
  assert.equal(filterBasis([]), FILTER_MIN_PX);
});

test("un'opzione lunga allarga il filtro invece di farsi troncare", () => {
  const basis = filterBasis(["📦 Team Magazzino CROSS-DOCKING"]);
  assert.ok(basis > FILTER_MIN_PX, `atteso più largo del minimo, ottenuto ${basis}`);
  assert.ok(basis <= FILTER_MAX_PX);
});

test("nemmeno un'opzione fuori scala sfonda il tetto", () => {
  assert.equal(filterBasis(["x".repeat(300)]), FILTER_MAX_PX);
});

test("conta l'opzione più lunga, non la prima", () => {
  assert.equal(filterBasis(["A", "x".repeat(40)]), filterBasis(["x".repeat(40)]));
});

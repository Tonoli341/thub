import test from "node:test";
import assert from "node:assert/strict";

import { computeCounterStats } from "./maintenanceCounterStats.js";

function reading(date, value) {
  return { reading_date: date, value };
}

test("nessuna lettura: tutte le statistiche sono null", () => {
  const stats = computeCounterStats([], new Date("2026-09-15"));
  assert.equal(stats.currentMonthDelta, null);
  assert.equal(stats.monthlyAverage, null);
  assert.equal(stats.yearlyAverage, null);
});

test("delta mese corrente usa l'ultima lettura del mese e del mese precedente", () => {
  const readings = [reading("2026-07-20", 100), reading("2026-08-05", 130), reading("2026-09-10", 150)];
  const stats = computeCounterStats(readings, new Date("2026-09-15"));
  assert.equal(stats.currentMonthDelta, 20);
});

test("più letture nello stesso mese: si usa solo l'ultima per periodo", () => {
  const readings = [
    reading("2026-08-01", 100),
    reading("2026-08-20", 120),
    reading("2026-09-01", 130),
    reading("2026-09-25", 150),
  ];
  const stats = computeCounterStats(readings, new Date("2026-09-30"));
  assert.equal(stats.currentMonthDelta, 30);
});

test("media mensile è la media dei delta tra mesi consecutivi con letture", () => {
  const readings = [reading("2026-06-01", 100), reading("2026-07-01", 120), reading("2026-08-01", 150)];
  const stats = computeCounterStats(readings, new Date("2026-08-15"));
  assert.equal(stats.monthlyAverage, 25);
});

test("media annuale è la media dei delta tra anni consecutivi con letture", () => {
  const readings = [reading("2024-12-01", 1000), reading("2025-12-01", 1900), reading("2026-06-01", 2500)];
  const stats = computeCounterStats(readings, new Date("2026-08-15"));
  assert.equal(stats.yearlyAverage, 750);
});

test("nessuna lettura nel mese precedente: delta mese corrente è null", () => {
  const readings = [reading("2026-09-10", 150)];
  const stats = computeCounterStats(readings, new Date("2026-09-15"));
  assert.equal(stats.currentMonthDelta, null);
});

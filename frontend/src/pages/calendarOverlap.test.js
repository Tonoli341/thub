import test from "node:test";
import assert from "node:assert/strict";

import { hasPlannerOverlap } from "./calendarOverlap.js";

const assignment = {
  employee_id: "matricola-28",
  work_date: "2026-08-03",
  start_time: "08:00:00",
  end_time: "14:00:00",
  break_start: "12:00:00",
  break_end: "14:00:00",
};

function absence(startTime, endTime, overrides = {}) {
  return {
    employee_id: "matricola-28",
    start_date: "2026-08-03",
    end_date: "2026-08-03",
    start_time: startTime,
    end_time: endTime,
    ...overrides,
  };
}

test("non segnala intervalli adiacenti alle 14:00", () => {
  assert.equal(hasPlannerOverlap(absence("14:00", "18:00"), assignment), false);
});

test("non segnala un'assenza interamente compresa nella pausa", () => {
  assert.equal(hasPlannerOverlap(absence("12:00", "14:00"), assignment), false);
});

test("segnala un'assenza che intercetta ore lavorate prima della pausa", () => {
  assert.equal(hasPlannerOverlap(absence("11:30", "12:30"), assignment), true);
});

test("segnala la sola parte lavorata dopo una pausa interna", () => {
  const assignmentWithAfternoonWork = { ...assignment, end_time: "16:00", break_end: "13:00" };
  assert.equal(hasPlannerOverlap(absence("12:30", "13:30"), assignmentWithAfternoonWork), true);
});

test("ignora dipendenti e giornate differenti", () => {
  assert.equal(hasPlannerOverlap(absence("09:00", "10:00", { employee_id: "altro" }), assignment), false);
  assert.equal(hasPlannerOverlap(absence("09:00", "10:00", { start_date: "2026-08-04", end_date: "2026-08-04" }), assignment), false);
});

test("mantiene un avviso prudenziale per record storici con orari non validi", () => {
  assert.equal(hasPlannerOverlap(absence("", ""), assignment), true);
});

test("l'elenco di dettaglio contiene soltanto le pianificazioni in conflitto", () => {
  const assignments = [
    assignment,
    { ...assignment, id: "pomeriggio", start_time: "15:00", end_time: "17:00", break_start: null, break_end: null },
  ];
  const matches = assignments.filter((item) => hasPlannerOverlap(absence("14:30", "15:30"), item));
  assert.deepEqual(matches.map((item) => item.id), ["pomeriggio"]);
});

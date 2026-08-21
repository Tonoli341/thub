import assert from "node:assert/strict";
import test from "node:test";

import { buildCopySourceTeams, notesForCopiedAssignment } from "./plannerCopy.js";

test("raggruppa per squadra solo le allocazioni che hanno note", () => {
  const teams = buildCopySourceTeams(
    [
      { id: "a1", employee_id: "e1", notes: "  Preparare la baia  " },
      { id: "a2", employee_id: "e2", notes: null },
      { id: "a3", employee_id: "e3", notes: "Controllare il carico", start_time: "08:00:00", end_time: "12:00:00" },
    ],
    {
      e1: { id: "t1", name: "Squadra Alfa", icon: "A" },
      e2: { id: "t1", name: "Squadra Alfa", icon: "A" },
    },
    { e1: "Mario Rossi", e2: "Luigi Bianchi", e3: "Anna Verdi" },
  );

  assert.equal(teams[0].count, 2);
  assert.deepEqual(teams[0].notedAssignments, [{
    id: "a1",
    employeeName: "Mario Rossi",
    notes: "Preparare la baia",
    startTime: "",
    endTime: "",
  }]);
  assert.equal(teams[1].name, "Senza squadra");
  assert.equal(teams[1].notedAssignments[0].employeeName, "Anna Verdi");
});

test("copia la nota solo quando la relativa allocazione e selezionata", () => {
  const assignment = { id: "a1", notes: "Nota da copiare" };

  assert.equal(notesForCopiedAssignment(assignment, new Set()), null);
  assert.equal(notesForCopiedAssignment(assignment, new Set(["a1"])), "Nota da copiare");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  MAINTENANCE_QUESTIONS,
  isMaintenanceAnswerComplete,
  maintenanceQuestionnaireProgress,
} from "./maintenanceQuestionnaire.js";


test("il questionario usa identificativi univoci", () => {
  const ids = MAINTENANCE_QUESTIONS.map((question) => question.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("il progresso conta testi e selezioni valorizzati", () => {
  assert.equal(isMaintenanceAnswerComplete("  "), false);
  assert.equal(isMaintenanceAnswerComplete("Risposta"), true);
  assert.equal(isMaintenanceAnswerComplete([]), false);
  assert.equal(isMaintenanceAnswerComplete(["PDF"]), true);

  const progress = maintenanceQuestionnaireProgress({ "1.1": "Problema", "2.1": ["Attrezzature"] });
  assert.equal(progress.completed, 2);
  assert.equal(progress.total, MAINTENANCE_QUESTIONS.length);
  assert.ok(progress.percent > 0);
});

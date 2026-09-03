import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyMaintenanceHistoryFilters,
  filterMaintenanceAssetHistory,
  maintenanceHistoryOptionValues,
} from "./maintenanceAssetHistoryFilters.js";

const history = [
  { id: "2", changed_field: "status", old_value: "attivo", new_value: "fuori_servizio", reason: "Guasto", changed_by: "Mario", changed_at: "2026-09-03T11:00:00Z" },
  { id: "1", changed_field: "site", old_value: null, new_value: "Fossano", reason: null, changed_by: "Luisa", changed_at: "2026-08-01T09:00:00Z" },
];

test("combina campo, autore, motivazione e intervallo data", () => {
  const filters = emptyMaintenanceHistoryFilters();
  filters.fields = ["status"];
  filters.actors = ["Mario"];
  filters.reason = "yes";
  filters.dateFrom = "2026-09-01";
  assert.deepEqual(filterMaintenanceAssetHistory(history, filters).map((item) => item.id), ["2"]);
});

test("filtra i valori precedenti non valorizzati", () => {
  const filters = emptyMaintenanceHistoryFilters();
  filters.oldValues = ["__missing__"];
  assert.deepEqual(filterMaintenanceAssetHistory(history, filters).map((item) => item.id), ["1"]);
});

test("la ricerca usa anche etichette e valori formattati", () => {
  const filters = emptyMaintenanceHistoryFilters();
  const rows = filterMaintenanceAssetHistory(history, filters, "fuori servizio", { status: "Stato" }, (_field, value) => value === "fuori_servizio" ? "Fuori servizio" : value);
  assert.deepEqual(rows.map((item) => item.id), ["2"]);
});

test("le opzioni dei valori rispettano i campi selezionati", () => {
  assert.deepEqual(maintenanceHistoryOptionValues(history, "new_value", ["site"]), ["Fossano"]);
});

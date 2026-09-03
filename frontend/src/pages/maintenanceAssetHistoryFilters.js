export const EMPTY_MAINTENANCE_HISTORY_FILTERS = Object.freeze({
  fields: [],
  actors: [],
  oldValues: [],
  newValues: [],
  reason: "",
  dateFrom: "",
  dateTo: "",
  sort: "newest",
});

export function emptyMaintenanceHistoryFilters() {
  return {
    ...EMPTY_MAINTENANCE_HISTORY_FILTERS,
    fields: [],
    actors: [],
    oldValues: [],
    newValues: [],
  };
}

function normalizedValue(value) {
  return value === null || value === undefined || value === "" ? "__missing__" : String(value);
}

export function filterMaintenanceAssetHistory(history, filters, search = "", fieldLabels = {}, valueFormatter = (_, value) => value) {
  const needle = search.trim().toLocaleLowerCase("it");
  const filtered = history.filter((item) => {
    if (needle) {
      const haystack = [
        fieldLabels[item.changed_field] ?? item.changed_field,
        valueFormatter(item.changed_field, item.old_value),
        valueFormatter(item.changed_field, item.new_value),
        item.reason,
        item.changed_by,
      ].filter(Boolean).join(" ").toLocaleLowerCase("it");
      if (!haystack.includes(needle)) return false;
    }
    if (filters.fields.length > 0 && !filters.fields.includes(item.changed_field)) return false;
    if (filters.actors.length > 0 && !filters.actors.includes(normalizedValue(item.changed_by))) return false;
    if (filters.oldValues.length > 0 && !filters.oldValues.includes(normalizedValue(item.old_value))) return false;
    if (filters.newValues.length > 0 && !filters.newValues.includes(normalizedValue(item.new_value))) return false;
    if (filters.reason === "yes" && !item.reason) return false;
    if (filters.reason === "no" && item.reason) return false;
    const changedDate = String(item.changed_at ?? "").slice(0, 10);
    if (filters.dateFrom && changedDate < filters.dateFrom) return false;
    if (filters.dateTo && changedDate > filters.dateTo) return false;
    return true;
  });

  return [...filtered].sort((first, second) => filters.sort === "oldest"
    ? String(first.changed_at).localeCompare(String(second.changed_at))
    : String(second.changed_at).localeCompare(String(first.changed_at)));
}

export function countMaintenanceHistoryFilters(filters) {
  let count = 0;
  if (filters.fields.length > 0) count += 1;
  if (filters.actors.length > 0) count += 1;
  if (filters.oldValues.length > 0) count += 1;
  if (filters.newValues.length > 0) count += 1;
  if (filters.reason) count += 1;
  if (filters.dateFrom || filters.dateTo) count += 1;
  if (filters.sort !== EMPTY_MAINTENANCE_HISTORY_FILTERS.sort) count += 1;
  return count;
}

export function maintenanceHistoryOptionValues(history, key, selectedFields = []) {
  const values = new Set();
  let hasMissing = false;
  for (const item of history) {
    if (selectedFields.length > 0 && !selectedFields.includes(item.changed_field)) continue;
    const value = normalizedValue(item[key]);
    if (value === "__missing__") hasMissing = true;
    else values.add(value);
  }
  const result = Array.from(values).sort((a, b) => a.localeCompare(b, "it", { numeric: true }));
  if (hasMissing) result.push("__missing__");
  return result;
}

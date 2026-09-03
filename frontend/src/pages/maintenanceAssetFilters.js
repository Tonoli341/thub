export const EMPTY_MAINTENANCE_ASSET_FILTERS = Object.freeze({
  statuses: [],
  assetTypeIds: [],
  attributes: {},
  hasMainImage: "",
  requiredFields: "",
  createdFrom: "",
  createdTo: "",
  updatedFrom: "",
  updatedTo: "",
  sort: "updated_desc",
});

export function emptyMaintenanceAssetFilters() {
  return {
    ...EMPTY_MAINTENANCE_ASSET_FILTERS,
    statuses: [],
    assetTypeIds: [],
    attributes: {},
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && value !== "";
}

function fieldAppliesToAsset(field, asset) {
  return field.assetTypeIds.length === 0 || field.assetTypeIds.includes(asset.asset_type_id);
}

function rawFieldValue(asset, field) {
  if (field.field_type === "image") return asset.image_field_ids?.[field.field_key] ? "present" : "missing";
  return asset.custom_fields?.[field.field_key];
}

function matchesAttribute(asset, field, condition) {
  if (!fieldAppliesToAsset(field, asset)) return false;
  const rawValue = rawFieldValue(asset, field);

  if (field.field_type === "number") {
    if (!hasValue(rawValue)) return false;
    const numericValue = Number(rawValue);
    if (!Number.isFinite(numericValue)) return false;
    if ((condition.exact ?? "") !== "" && numericValue !== Number(condition.exact)) return false;
    if ((condition.min ?? "") !== "" && numericValue < Number(condition.min)) return false;
    if ((condition.max ?? "") !== "" && numericValue > Number(condition.max)) return false;
    return true;
  }

  if (field.field_type === "date") {
    if (!hasValue(rawValue)) return false;
    const dateValue = String(rawValue).slice(0, 10);
    if (condition.min && dateValue < condition.min) return false;
    if (condition.max && dateValue > condition.max) return false;
    return true;
  }

  return (condition.values ?? []).includes(hasValue(rawValue) ? String(rawValue) : "__missing__");
}

function requiredFieldsComplete(asset, fields) {
  return fields
    .filter((field) => field.is_required && fieldAppliesToAsset(field, asset))
    .every((field) => hasValue(rawFieldValue(asset, field)) && rawFieldValue(asset, field) !== "missing");
}

function dateInRange(value, from, to) {
  const dateValue = String(value ?? "").slice(0, 10);
  if (!dateValue) return false;
  return (!from || dateValue >= from) && (!to || dateValue <= to);
}

function yearValue(asset, yearField) {
  if (!yearField || !fieldAppliesToAsset(yearField, asset)) return null;
  const value = Number(rawFieldValue(asset, yearField));
  return Number.isFinite(value) ? value : null;
}

function compareNullableNumbers(first, second) {
  if (first === null && second === null) return 0;
  if (first === null) return 1;
  if (second === null) return -1;
  return first - second;
}

export function filterMaintenanceAssets(assets, filters, fields, search = "", yearField = null) {
  const needle = search.trim().toLocaleLowerCase("it");
  const activeAttributes = Object.entries(filters.attributes ?? {}).filter(([, condition]) =>
    (condition.values?.length ?? 0) > 0 || (condition.exact ?? "") !== "" || (condition.min ?? "") !== "" || (condition.max ?? "") !== "",
  );

  const filtered = assets.filter((asset) => {
    if (needle) {
      const haystack = [
        asset.internal_code,
        asset.asset_type_label,
        ...Object.values(asset.custom_fields ?? {}),
        ...Object.values(asset.employee_field_names ?? {}),
      ].filter(hasValue).join(" ").toLocaleLowerCase("it");
      if (!haystack.includes(needle)) return false;
    }
    if (filters.statuses.length > 0 && !filters.statuses.includes(asset.status)) return false;
    if (filters.assetTypeIds.length > 0 && !filters.assetTypeIds.includes(asset.asset_type_id)) return false;
    if (filters.hasMainImage === "yes" && !asset.main_image_id) return false;
    if (filters.hasMainImage === "no" && asset.main_image_id) return false;
    if (filters.createdFrom || filters.createdTo) {
      if (!dateInRange(asset.created_at, filters.createdFrom, filters.createdTo)) return false;
    }
    if (filters.updatedFrom || filters.updatedTo) {
      if (!dateInRange(asset.updated_at, filters.updatedFrom, filters.updatedTo)) return false;
    }
    const complete = requiredFieldsComplete(asset, fields);
    if (filters.requiredFields === "complete" && !complete) return false;
    if (filters.requiredFields === "incomplete" && complete) return false;

    return activeAttributes.every(([fieldId, condition]) => {
      const field = fields.find((item) => item.filterId === fieldId);
      return field ? matchesAttribute(asset, field, condition) : true;
    });
  });

  return [...filtered].sort((first, second) => {
    if (filters.sort === "created_asc") return String(first.created_at).localeCompare(String(second.created_at));
    if (filters.sort === "created_desc") return String(second.created_at).localeCompare(String(first.created_at));
    if (filters.sort === "updated_asc") return String(first.updated_at).localeCompare(String(second.updated_at));
    if (filters.sort === "code_asc") return first.internal_code.localeCompare(second.internal_code, "it", { numeric: true });
    if (filters.sort === "oldest") return compareNullableNumbers(yearValue(first, yearField), yearValue(second, yearField));
    return String(second.updated_at).localeCompare(String(first.updated_at));
  });
}

export function countMaintenanceAssetFilters(filters) {
  let count = 0;
  if (filters.statuses.length > 0) count += 1;
  if (filters.assetTypeIds.length > 0) count += 1;
  if (filters.hasMainImage) count += 1;
  if (filters.requiredFields) count += 1;
  if (filters.createdFrom || filters.createdTo) count += 1;
  if (filters.updatedFrom || filters.updatedTo) count += 1;
  if (filters.sort !== EMPTY_MAINTENANCE_ASSET_FILTERS.sort) count += 1;
  count += Object.values(filters.attributes ?? {}).filter((condition) =>
    (condition.values?.length ?? 0) > 0 || (condition.exact ?? "") !== "" || (condition.min ?? "") !== "" || (condition.max ?? "") !== "",
  ).length;
  return count;
}

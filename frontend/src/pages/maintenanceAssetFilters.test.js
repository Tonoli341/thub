import test from "node:test";
import assert from "node:assert/strict";

import {
  emptyMaintenanceAssetFilters,
  filterMaintenanceAssets,
} from "./maintenanceAssetFilters.js";

const fields = [
  { filterId: "class-site", field_key: "site", field_type: "select", is_required: true, assetTypeIds: [] },
  { filterId: "type-wheels", field_key: "numero_ruote", field_type: "number", is_required: false, assetTypeIds: ["frontale"] },
  { filterId: "type-plate", field_key: "targa_ce", field_type: "image", is_required: false, assetTypeIds: ["frontale"] },
];

const assets = [
  {
    id: "old",
    asset_type_id: "frontale",
    asset_type_label: "Frontale",
    internal_code: "CE-001",
    status: "attivo",
    custom_fields: { site: "Sede", numero_ruote: 4, anno_costruzione: 2012 },
    employee_field_names: {},
    image_field_ids: { targa_ce: "img-1" },
    main_image_id: "main-1",
    created_at: "2025-01-01T10:00:00Z",
    updated_at: "2026-01-01T10:00:00Z",
  },
  {
    id: "new",
    asset_type_id: "retrattile",
    asset_type_label: "Retrattile",
    internal_code: "CE-002",
    status: "fuori_servizio",
    custom_fields: { site: "Saluzzo", anno_costruzione: 2022 },
    employee_field_names: {},
    image_field_ids: {},
    main_image_id: null,
    created_at: "2026-01-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  },
];

test("filtra un attributo numerico specifico della sottoclasse", () => {
  const filters = emptyMaintenanceAssetFilters();
  filters.attributes["type-wheels"] = { exact: "4" };
  assert.deepEqual(filterMaintenanceAssets(assets, filters, fields).map((asset) => asset.id), ["old"]);
});

test("filtra attributi immagine e campi obbligatori mancanti", () => {
  const filters = emptyMaintenanceAssetFilters();
  filters.attributes["type-plate"] = { values: ["present"] };
  filters.requiredFields = "complete";
  assert.deepEqual(filterMaintenanceAssets(assets, filters, fields).map((asset) => asset.id), ["old"]);
});

test("ordina gli asset dal più vecchio lasciando in fondo i valori mancanti", () => {
  const filters = emptyMaintenanceAssetFilters();
  filters.sort = "oldest";
  const yearField = { filterId: "year", field_key: "anno_costruzione", field_type: "number", is_required: false, assetTypeIds: [] };
  assert.deepEqual(filterMaintenanceAssets(assets, filters, [...fields, yearField], "", yearField).map((asset) => asset.id), ["old", "new"]);
});

test("la ricerca comprende etichetta sottoclasse e valori degli attributi", () => {
  const filters = emptyMaintenanceAssetFilters();
  assert.deepEqual(filterMaintenanceAssets(assets, filters, fields, "retrattile").map((asset) => asset.id), ["new"]);
  assert.deepEqual(filterMaintenanceAssets(assets, filters, fields, "saluzzo").map((asset) => asset.id), ["new"]);
});

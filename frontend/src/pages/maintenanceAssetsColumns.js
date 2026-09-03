export const MAINTENANCE_ASSETS_COLUMNS = [
  { key: "asset", label: "Asset", width: 32 },
  { key: "brand_model", label: "Produttore / Modello", width: 23 },
  { key: "site", label: "Collocazione", width: 17 },
  { key: "status", label: "Stato operativo", width: 16, align: "center" },
  { key: "updated", label: "Aggiornato", width: 12, align: "right" },
];

export const MAINTENANCE_ASSET_STATUS_LABELS = {
  attivo: "Attivo",
  in_manutenzione: "In manutenzione",
  dismesso: "Dismesso",
  fuori_servizio: "Fuori servizio",
};

export const MAINTENANCE_ASSET_STATUS_COLORS = {
  attivo: "success",
  in_manutenzione: "warning",
  dismesso: "default",
  fuori_servizio: "error",
};

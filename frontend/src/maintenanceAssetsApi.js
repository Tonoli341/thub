import { download, fetchBlobUrl, request, requestFormData } from "./api";

export function getMaintenanceAssetFamilies() {
  return request("/maintenance/asset-families");
}

export function createMaintenanceAssetFamily(payload) {
  return request("/maintenance/asset-families", { method: "POST", body: JSON.stringify(payload) });
}

export function updateMaintenanceAssetFamily(assetFamilyId, payload) {
  return request(`/maintenance/asset-families/${assetFamilyId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceAssetFamily(assetFamilyId) {
  return request(`/maintenance/asset-families/${assetFamilyId}`, { method: "DELETE" });
}

export function reorderMaintenanceAssetFamilies(orderedIds) {
  return request("/maintenance/asset-families/reorder", {
    method: "PATCH",
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
}

export function getMaintenanceAssetClasses() {
  return request("/maintenance/asset-classes");
}

export function createMaintenanceAssetClass(assetFamilyId, payload) {
  return request(`/maintenance/asset-families/${assetFamilyId}/classes`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMaintenanceAssetClass(assetClassId, payload) {
  return request(`/maintenance/asset-classes/${assetClassId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceAssetClass(assetClassId) {
  return request(`/maintenance/asset-classes/${assetClassId}`, { method: "DELETE" });
}

export function reorderMaintenanceAssetClasses(assetFamilyId, orderedIds) {
  return request(`/maintenance/asset-families/${assetFamilyId}/classes/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
}

export function createMaintenanceAssetType(assetClassId, payload) {
  return request(`/maintenance/asset-classes/${assetClassId}/types`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateMaintenanceAssetType(assetTypeId, payload) {
  return request(`/maintenance/asset-types/${assetTypeId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceAssetType(assetTypeId) {
  return request(`/maintenance/asset-types/${assetTypeId}`, { method: "DELETE" });
}

export function reorderMaintenanceAssetTypes(assetClassId, orderedIds) {
  return request(`/maintenance/asset-classes/${assetClassId}/types/reorder`, {
    method: "PATCH",
    body: JSON.stringify({ ordered_ids: orderedIds }),
  });
}

export function createMaintenanceAssetField(assetTypeId, payload) {
  return request(`/maintenance/asset-types/${assetTypeId}/fields`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Attributo generico di classe (comune a tutte le sottoclassi, es. sito,
// produttore, modello, numero di serie): stesso payload dei campi di
// sottoclasse, cambia solo l'endpoint di aggancio.
export function createMaintenanceClassField(assetClassId, payload) {
  return request(`/maintenance/asset-classes/${assetClassId}/fields`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// Modifica un campo esistente, di classe o di sottoclasse indifferentemente
// (l'endpoint è unico): field_key non è incluso, non è modificabile.
export function updateMaintenanceAssetField(fieldId, payload) {
  return request(`/maintenance/asset-fields/${fieldId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceAssetField(fieldId) {
  return request(`/maintenance/asset-fields/${fieldId}`, { method: "DELETE" });
}

export function getMaintenanceAssets({ assetTypeId = "", assetClassId = "", search = "", status = "" } = {}) {
  const params = new URLSearchParams();
  if (assetTypeId) params.set("asset_type_id", assetTypeId);
  if (assetClassId) params.set("asset_class_id", assetClassId);
  if (search.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  const query = params.toString();
  return request(`/maintenance/assets${query ? `?${query}` : ""}`);
}

export function downloadMaintenanceAssetsExport({ assetTypeId = "", assetClassId = "", search = "", status = "" } = {}) {
  const params = new URLSearchParams();
  if (assetTypeId) params.set("asset_type_id", assetTypeId);
  if (assetClassId) params.set("asset_class_id", assetClassId);
  if (search.trim()) params.set("search", search.trim());
  if (status) params.set("status", status);
  const query = params.toString();
  return download(`/maintenance/assets/export${query ? `?${query}` : ""}`, "manutenzioni-asset.xlsx");
}

export function downloadMaintenanceAssetCountersExport() {
  return download("/maintenance/assets/counters/export", "manutenzioni-ore.xlsx");
}

export function createMaintenanceAsset(payload) {
  return request("/maintenance/assets", { method: "POST", body: JSON.stringify(payload) });
}

export function getMaintenanceAsset(assetId) {
  return request(`/maintenance/assets/${assetId}`);
}

export function updateMaintenanceAsset(assetId, payload) {
  return request(`/maintenance/assets/${assetId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceAsset(assetId) {
  return request(`/maintenance/assets/${assetId}`, { method: "DELETE" });
}

export function uploadMaintenanceAssetImageField(assetId, fieldKey, file) {
  const formData = new FormData();
  formData.append("file", file);
  return requestFormData(`/maintenance/assets/${assetId}/custom-fields/${fieldKey}/image`, formData);
}

export function removeMaintenanceAssetImageField(assetId, fieldKey) {
  return request(`/maintenance/assets/${assetId}/custom-fields/${fieldKey}/image`, { method: "DELETE" });
}

export function uploadMaintenanceAssetMainImage(assetId, file) {
  const formData = new FormData();
  formData.append("file", file);
  return requestFormData(`/maintenance/assets/${assetId}/main-image`, formData);
}

export function removeMaintenanceAssetMainImage(assetId) {
  return request(`/maintenance/assets/${assetId}/main-image`, { method: "DELETE" });
}

export function fetchMaintenanceDocumentBlobUrl(documentId) {
  return fetchBlobUrl(`/maintenance/documents/${documentId}/download`);
}

export function fetchMaintenanceImageBlobUrl(imageId) {
  return fetchBlobUrl(`/maintenance/images/${imageId}/content`);
}

// L'endpoint richiede il Bearer token: un window.open diretto sull'URL API
// non lo manderebbe. Si scarica il blob autenticato e si apre quello.
export async function openMaintenanceDocumentInNewTab(documentId) {
  const url = await fetchMaintenanceDocumentBlobUrl(documentId);
  window.open(url, "_blank", "noopener");
}

export function getMaintenanceAssetQrToken(assetId) {
  return request(`/maintenance/assets/${assetId}/qr-token`);
}

export function regenerateMaintenanceAssetQrToken(assetId) {
  return request(`/maintenance/assets/${assetId}/qr-token/regenerate`, { method: "POST" });
}

// L'immagine PNG richiede il Bearer token: stesso motivo di
// fetchMaintenanceDocumentBlobUrl, non si può fare un window.open diretto.
export function fetchMaintenanceAssetQrImageBlobUrl(assetId) {
  return fetchBlobUrl(`/maintenance/assets/${assetId}/qr-token/image`);
}

export function getMaintenanceAssetHistory(assetId) {
  return request(`/maintenance/assets/${assetId}/history`);
}

export function getMaintenanceAssetComments(assetId) {
  return request(`/maintenance/assets/${assetId}/comments`);
}

export function createMaintenanceAssetComment(assetId, payload) {
  return request(`/maintenance/assets/${assetId}/comments`, { method: "POST", body: JSON.stringify(payload) });
}

export function getMaintenanceAssetCounters(assetId) {
  return request(`/maintenance/assets/${assetId}/counters`);
}

export function getMaintenanceAssetClassCounters(assetClassId) {
  return request(`/maintenance/asset-classes/${assetClassId}/counters`);
}

export function createMaintenanceAssetCounter(assetId, payload) {
  return request(`/maintenance/assets/${assetId}/counters`, { method: "POST", body: JSON.stringify(payload) });
}

export function updateMaintenanceAssetCounter(assetId, counterId, payload) {
  return request(`/maintenance/assets/${assetId}/counters/${counterId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceAssetCounter(assetId, counterId) {
  return request(`/maintenance/assets/${assetId}/counters/${counterId}`, { method: "DELETE" });
}

export function getMaintenanceDocuments(assetId, { includeObsolete = false } = {}) {
  const params = new URLSearchParams({ include_obsolete: String(includeObsolete) });
  return request(`/maintenance/assets/${assetId}/documents?${params.toString()}`);
}

export function uploadMaintenanceDocument(assetId, { docType, title, file }) {
  const formData = new FormData();
  formData.append("doc_type", docType);
  formData.append("title", title);
  formData.append("file", file);
  return requestFormData(`/maintenance/assets/${assetId}/documents`, formData);
}

export function updateMaintenanceDocumentStatus(documentId, status) {
  return request(`/maintenance/documents/${documentId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export function downloadMaintenanceDocument(documentId, filename) {
  return download(`/maintenance/documents/${documentId}/download`, filename);
}

export function deleteMaintenanceDocument(documentId, reason) {
  return request(`/maintenance/documents/${documentId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function getMaintenancePhotos(assetId) {
  return request(`/maintenance/assets/${assetId}/photos`);
}

export function uploadMaintenancePhoto(assetId, { title, file }) {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("file", file);
  return requestFormData(`/maintenance/assets/${assetId}/photos`, formData);
}

export function deleteMaintenanceImage(imageId, reason) {
  return request(`/maintenance/images/${imageId}`, {
    method: "DELETE",
    body: JSON.stringify({ reason }),
  });
}

export function downloadMaintenanceImage(imageId, filename) {
  return download(`/maintenance/images/${imageId}/content`, filename);
}

// Pagina pubblica del QR: nessun login richiesto, ma passa comunque da
// request() come tutto il resto del client (niente fetch diretto in pagina).
export function getMaintenanceAssetPublic(token) {
  return request(`/maintenance/assets/public/${token}`);
}

// Foto della pagina pubblica: stesso endpoint pubblico (nessun Bearer
// necessario, ma fetchBlobUrl lo aggiunge solo se presente, quindi funziona
// comunque per chi la apre da loggato).
export function fetchMaintenanceAssetPublicImageBlobUrl(token, imageId) {
  return fetchBlobUrl(`/maintenance/assets/public/${token}/images/${imageId}`);
}

export function getMaintenanceDeadlines() {
  return request("/maintenance/deadlines");
}

export function getMaintenanceAssetDeadlines(assetId) {
  return request(`/maintenance/assets/${assetId}/deadlines`);
}

export function createMaintenanceDeadline(assetId, payload) {
  return request(`/maintenance/assets/${assetId}/deadlines`, { method: "POST", body: JSON.stringify(payload) });
}

export function completeMaintenanceDeadline(deadlineId, payload) {
  return request(`/maintenance/deadlines/${deadlineId}/complete`, { method: "POST", body: JSON.stringify(payload) });
}

export function postponeMaintenanceDeadline(deadlineId, payload) {
  return request(`/maintenance/deadlines/${deadlineId}/postpone`, { method: "POST", body: JSON.stringify(payload) });
}

export function ackMaintenanceDeadline(deadlineId) {
  return request(`/maintenance/deadlines/${deadlineId}/ack`, { method: "POST" });
}

export function deleteMaintenanceDeadline(deadlineId) {
  return request(`/maintenance/deadlines/${deadlineId}`, { method: "DELETE" });
}

export function downloadMaintenanceDeadlinesExport() {
  return download("/maintenance/deadlines/export", "manutenzioni-scadenze.xlsx");
}

export function getMaintenanceNotificationRules() {
  return request("/maintenance/notification-rules");
}

export function createMaintenanceNotificationRule(payload) {
  return request("/maintenance/notification-rules", { method: "POST", body: JSON.stringify(payload) });
}

export function updateMaintenanceNotificationRule(ruleId, payload) {
  return request(`/maintenance/notification-rules/${ruleId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteMaintenanceNotificationRule(ruleId) {
  return request(`/maintenance/notification-rules/${ruleId}`, { method: "DELETE" });
}

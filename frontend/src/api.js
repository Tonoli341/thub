const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const TOKEN_STORAGE_KEY = "workforce-planner-token";
const AUTH_LOGOUT_EVENT = "workforce-planner-auth-logout";

let _impersonateEmployeeId = null;

export function setImpersonateEmployeeId(id) {
  _impersonateEmployeeId = id ?? null;
}

export async function request(path, options = {}) {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(_impersonateEmployeeId ? { "X-Impersonate-Employee": _impersonateEmployeeId } : {}),
      ...(options.headers ?? {}),
    },
    ...options,
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const payload = await response.json();
      const raw = payload.detail ?? detail;
      detail = Array.isArray(raw) ? raw.map((e) => e.msg ?? JSON.stringify(e)).join(", ") : String(raw);
    } catch {
      detail = response.statusText || detail;
    }
    if (response.status === 401) {
      clearAccessToken();
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function requestFormData(path, formData, options = {}) {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: "POST",
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(_impersonateEmployeeId ? { "X-Impersonate-Employee": _impersonateEmployeeId } : {}),
      ...(options.headers ?? {}),
    },
    body: formData,
    ...options,
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const payload = await response.json();
      const raw = payload.detail ?? detail;
      detail = Array.isArray(raw) ? raw.map((e) => e.msg ?? JSON.stringify(e)).join(", ") : String(raw);
    } catch {
      detail = response.statusText || detail;
    }
    if (response.status === 401) {
      clearAccessToken();
    }
    throw new Error(detail);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

/** Come `download`, ma restituisce un blob URL per mostrare il contenuto
 * inline (es. un'anteprima immagine) invece di avviare il salvataggio. Chi lo
 * chiama deve revocare l'URL con `URL.revokeObjectURL` quando non serve più. */
export async function fetchBlobUrl(path) {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(_impersonateEmployeeId ? { "X-Impersonate-Employee": _impersonateEmployeeId } : {}),
    },
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const payload = await response.json();
      detail = String(payload.detail ?? detail);
    } catch {
      detail = response.statusText || detail;
    }
    if (response.status === 401) {
      clearAccessToken();
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  return window.URL.createObjectURL(blob);
}

export async function download(path, fallbackFilename = "download") {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(_impersonateEmployeeId ? { "X-Impersonate-Employee": _impersonateEmployeeId } : {}),
    },
  });

  if (!response.ok) {
    let detail = "Request failed";
    try {
      const payload = await response.json();
      detail = String(payload.detail ?? detail);
    } catch {
      detail = response.statusText || detail;
    }
    if (response.status === 401) {
      clearAccessToken();
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  const contentDisposition = response.headers.get("Content-Disposition") || "";
  const match = contentDisposition.match(/filename="?([^"]+)"?/i);
  const filename = match?.[1] || fallbackFilename;
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(url);
}

export function getAccessToken() {
  return window.localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setAccessToken(token) {
  window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function clearAccessToken() {
  window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  window.dispatchEvent(new Event(AUTH_LOGOUT_EVENT));
}

export function subscribeToAuthLogout(handler) {
  window.addEventListener(AUTH_LOGOUT_EVENT, handler);
  return () => window.removeEventListener(AUTH_LOGOUT_EVENT, handler);
}

export function login(payload) {
  return request("/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function getCurrentUser() {
  return request("/auth/me");
}

export function refreshSession() {
  return request("/auth/refresh", { method: "POST" });
}

export function getImpersonationView(employeeId) {
  return request(`/auth/impersonate/${employeeId}`);
}

export function getDashboard(date) {
  return request(`/dashboard?date=${date}`);
}

export function getDashboardBirthdays(days = 7) {
  return request(`/dashboard/birthdays?days=${days}`);
}

export function getDashboardMe(employeeId, date) {
  return request(`/dashboard/me?employee_id=${employeeId}&date=${date}`);
}

export function getDashboardApprover(employeeId) {
  return request(`/dashboard/approver?employee_id=${employeeId}`);
}

export function getDashboardExpirations(days = 30) {
  return request(`/dashboard/expirations?days=${days}`);
}

export function getEmployees(search = "", roles = [], activeOnly = true) {
  const params = new URLSearchParams({ active_only: String(activeOnly) });
  if (search.trim()) {
    params.set("search", search.trim());
  }
  for (const role of roles) {
    params.append("roles", role);
  }
  return request(`/employees?${params.toString()}`);
}

export function getPlannerEmployees(search = "", roles = []) {
  const params = new URLSearchParams({ active_only: "true" });
  if (search.trim()) {
    params.set("search", search.trim());
  }
  for (const role of roles) {
    params.append("roles", role);
  }
  return request(`/employees/planner?${params.toString()}`);
}

export async function getEmployeePhoto(employeeId) {
  const token = getAccessToken();
  const response = await fetch(`${API_BASE_URL}/employees/${employeeId}/photo`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 401) {
      clearAccessToken();
    }
    throw new Error(response.statusText || "Request failed");
  }

  return response.blob();
}

export function getEmployeeExpirations(employeeId) {
  return request(`/employees/${employeeId}/expirations`);
}

export function getEmployeeCourseBadges() {
  return request("/employees/course-badges");
}

export function getEmployeeOptions({ authorizedForAbsence = false } = {}) {
  const params = new URLSearchParams({ active_only: "true" });
  if (authorizedForAbsence) {
    params.set("authorized_for_absence", "true");
  }
  return request(`/employees/options?${params.toString()}`);
}

export function getLdapEmployees(search = "") {
  const params = new URLSearchParams({ active_only: "true" });
  if (search.trim()) {
    params.set("search", search.trim());
  }
  return request(`/ldap-employees?${params.toString()}`);
}

export function updateLdapEmployeeTmsLink(ldapEmployeeId, payload) {
  return request(`/ldap-employees/${ldapEmployeeId}/tms-link`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function unlockLdapEmployeeLogin(ldapEmployeeId) {
  return request(`/ldap-employees/${ldapEmployeeId}/unlock-login`, {
    method: "POST",
  });
}

export function updateEmployeePhone(employeeId, payload) {
  return request(`/employees/${employeeId}/phone`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeDefaultArea(employeeId, payload) {
  return request(`/employees/${employeeId}/default-area`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeManager(employeeId, payload) {
  return request(`/employees/${employeeId}/manager`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeOrganization(employeeId, payload) {
  return request(`/employees/${employeeId}/organization`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeAbsencePermissions(employeeId, payload) {
  return request(`/employees/${employeeId}/absence-permissions`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeConfigurationPermissions(employeeId, payload) {
  return request(`/employees/${employeeId}/configuration-permissions`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeAppRole(employeeId, payload) {
  return request(`/employees/${employeeId}/app-role`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeSchedule(employeeId, payload) {
  return request(`/employees/${employeeId}/schedule`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function updateEmployeeLocalUser(employeeId, payload) {
  return request(`/employees/${employeeId}/local-user`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function syncEmployees() {
  return request("/employees/sync", { method: "POST" });
}

export function getDeliveries({ status = "open", employeeId = "", search = "", page = 1, size = 200 } = {}) {
  const params = new URLSearchParams({ status, page: String(page), size: String(size) });
  if (employeeId) params.set("employee_id", employeeId);
  if (search.trim()) params.set("search", search.trim());
  return request(`/deliveries?${params.toString()}`);
}

export function markDeliveryReturned(deliveryId, payload = {}) {
  return request(`/deliveries/${deliveryId}/return`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteDelivery(deliveryId) {
  return request(`/deliveries/${deliveryId}`, {
    method: "DELETE",
  });
}

export function getEquipmentItems({ includeInactive = false } = {}) {
  const params = new URLSearchParams({ include_inactive: String(includeInactive) });
  return request(`/equipment-items?${params.toString()}`);
}

export function createEquipmentItem(payload) {
  return request("/equipment-items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateEquipmentItem(itemId, payload) {
  return request(`/equipment-items/${itemId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getDeliverySizeGroups() {
  return request("/equipment-items/size-groups");
}

export function downloadDeliveriesExport({ status = "open", employeeId = "", search = "" } = {}) {
  const params = new URLSearchParams({ status });
  if (employeeId) params.set("employee_id", employeeId);
  if (search.trim()) params.set("search", search.trim());
  return download(`/deliveries/export?${params.toString()}`, "consegne.xlsx");
}

export function downloadEmployeeDeliverySheet(employeeId, { includeReturned = false } = {}) {
  const params = new URLSearchParams({ include_returned: String(includeReturned) });
  return download(`/deliveries/export/employee/${employeeId}?${params.toString()}`, "scheda-consegna.docx");
}

export function getDeviceAssets({ includeInactive = false } = {}) {
  const params = new URLSearchParams({ include_inactive: String(includeInactive) });
  return request(`/device-assets?${params.toString()}`);
}

export function syncDeviceAssets() {
  return request("/device-assets/sync", { method: "POST" });
}

export function createDeviceAsset(payload) {
  return request("/device-assets", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateDeviceAsset(deviceId, payload) {
  return request(`/device-assets/${deviceId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getDeviceDeliveries({ status = "open", employeeId = "", search = "", page = 1, size = 200 } = {}) {
  const params = new URLSearchParams({ status, page: String(page), size: String(size) });
  if (employeeId) params.set("employee_id", employeeId);
  if (search.trim()) params.set("search", search.trim());
  return request(`/device-deliveries?${params.toString()}`);
}

export function createDeviceDeliveryAssignment(payload) {
  return request("/device-deliveries", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function redeliverDeviceDelivery(deliveryId) {
  return request(`/device-deliveries/${deliveryId}/redeliver`, {
    method: "POST",
  });
}

export function deleteDeviceDeliveryAssignment(deliveryId) {
  return request(`/device-deliveries/${deliveryId}`, {
    method: "DELETE",
  });
}

export function markDeviceDeliveryReturned(deliveryId) {
  return request(`/device-deliveries/${deliveryId}/return`, { method: "POST" });
}

export function requestDeviceDeliverySignature(deliveryId) {
  return request(`/device-deliveries/${deliveryId}/request-signature`, { method: "POST" });
}

export function getMyDeviceDelivery(deliveryId) {
  return request(`/device-deliveries/my/${deliveryId}`);
}

export function signMyDeviceDelivery(deliveryId, imageB64, { policyAccepted = false } = {}) {
  return request(`/device-deliveries/my/${deliveryId}/sign`, {
    method: "POST",
    body: JSON.stringify({ signature: { image_b64: imageB64 }, policy_accepted: policyAccepted }),
  });
}

export function getDeviceDeliveryPolicy() {
  return request("/device-deliveries/policy");
}

export function updateDeviceDeliveryPolicy(payload) {
  return request("/device-deliveries/policy", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function downloadDeviceDeliveriesExport({ status = "open", employeeId = "", search = "" } = {}) {
  const params = new URLSearchParams({ status });
  if (employeeId) params.set("employee_id", employeeId);
  if (search.trim()) params.set("search", search.trim());
  return download(`/device-deliveries/export?${params.toString()}`, "consegne-dispositivi.xlsx");
}

export function getOperationalAreas({ activeOnly = false, operationalOnly = false, search = "" } = {}) {
  const params = new URLSearchParams({ active_only: String(activeOnly) });
  if (operationalOnly) params.set("operational_only", "true");
  if (search.trim()) params.set("search", search.trim());
  return request(`/operational-areas?${params.toString()}`);
}

export function getLocalProjects({ activeOnly = false, search = "" } = {}) {
  const params = new URLSearchParams({ active_only: String(activeOnly) });
  if (search.trim()) params.set("search", search.trim());
  return request(`/projects?${params.toString()}`);
}

export function createLocalProject(payload) {
  return request("/projects", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateLocalProject(projectId, payload) {
  return request(`/projects/${projectId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteLocalProject(projectId) {
  return request(`/projects/${projectId}`, {
    method: "DELETE",
  });
}

export function getInfinityBillingItems({ activeOnly = false } = {}) {
  const params = new URLSearchParams({ active_only: String(activeOnly) });
  return request(`/infinity-billing-items?${params.toString()}`);
}

export function createInfinityBillingItem(payload) {
  return request("/infinity-billing-items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInfinityBillingItem(itemId, payload) {
  return request(`/infinity-billing-items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteInfinityBillingItem(itemId) {
  return request(`/infinity-billing-items/${itemId}`, {
    method: "DELETE",
  });
}

export function getInfinityBillingCustomerSupplierMap() {
  return request("/infinity-billing-customer-supplier-map");
}

export function createInfinityBillingCustomerSupplierMap(payload) {
  return request("/infinity-billing-customer-supplier-map", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInfinityBillingCustomerSupplierMap(mapId, payload) {
  return request(`/infinity-billing-customer-supplier-map/${mapId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteInfinityBillingCustomerSupplierMap(mapId) {
  return request(`/infinity-billing-customer-supplier-map/${mapId}`, {
    method: "DELETE",
  });
}

export function replaceInfinityMapFieldAssignments(mapId, assignments) {
  return request(`/infinity-billing-customer-supplier-map/${mapId}/field-assignments`, {
    method: "PUT",
    body: JSON.stringify({ assignments }),
  });
}

// ── Field Definitions ─────────────────────────────────────────────────────────

export function getFieldDefinitions() {
  return request("/field-definitions");
}

export function createFieldDefinition(payload) {
  return request("/field-definitions", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateFieldDefinition(fieldDefId, payload) {
  return request(`/field-definitions/${fieldDefId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteFieldDefinition(fieldDefId) {
  return request(`/field-definitions/${fieldDefId}`, {
    method: "DELETE",
  });
}

// Sorgenti value-list: insieme chiuso definito lato server. La UI sceglie una
// sorgente per chiave, la SQL non passa mai di qui.
export function getValueListSources() {
  return request("/field-definitions/value-list-sources");
}

export function getValueListSourceColumns(sourceKey) {
  return request(`/field-definitions/value-list-sources/${sourceKey}/columns`);
}

export function createOperationalArea(payload) {
  return request("/operational-areas", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateOperationalArea(areaId, payload) {
  return request(`/operational-areas/${areaId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteOperationalArea(areaId) {
  return request(`/operational-areas/${areaId}`, {
    method: "DELETE",
  });
}

export function getAssignments(start, end) {
  return request(`/assignments?start=${start}&end=${end}`);
}

export function getPlannerDayAudit(workDate) {
  return request(`/assignments/day-audit?work_date=${workDate}`);
}

export function createAssignment(payload) {
  return request("/assignments", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateAssignment(assignmentId, payload) {
  return request(`/assignments/${assignmentId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteAssignment(assignmentId) {
  return request(`/assignments/${assignmentId}`, { method: "DELETE" });
}

// ── Formazione ────────────────────────────────────────────────────────────
export function getTrainingMacroAreas({ activeOnly = false } = {}) {
  const params = new URLSearchParams();
  if (activeOnly) params.set("active_only", "true");
  return request(`/training-macro-areas?${params.toString()}`);
}

export function createTrainingMacroArea(payload) {
  return request("/training-macro-areas", { method: "POST", body: JSON.stringify(payload) });
}

export function updateTrainingMacroArea(areaId, payload) {
  return request(`/training-macro-areas/${areaId}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteTrainingMacroArea(areaId) {
  return request(`/training-macro-areas/${areaId}`, { method: "DELETE" });
}

export function getTrainingCourses({ activeOnly = false } = {}) {
  const params = new URLSearchParams();
  if (activeOnly) params.set("active_only", "true");
  return request(`/training-courses?${params.toString()}`);
}

export function createTrainingCourse(payload) {
  return request("/training-courses", { method: "POST", body: JSON.stringify(payload) });
}

export function updateTrainingCourse(courseId, payload) {
  return request(`/training-courses/${courseId}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteTrainingCourse(courseId) {
  return request(`/training-courses/${courseId}`, { method: "DELETE" });
}

export function getTrainingHoursReport(start, end, employeeId = "") {
  const params = new URLSearchParams({ start, end });
  if (employeeId) params.set("employee_id", employeeId);
  return request(`/training/hours-report?${params.toString()}`);
}

export function downloadTrainingHoursReport(start, end, employeeId = "") {
  const params = new URLSearchParams({ start, end });
  if (employeeId) params.set("employee_id", employeeId);
  return download(`/training/hours-report.csv?${params.toString()}`, `formazione_${start}_${end}.csv`);
}

export function getJustifications(start, end, employeeId = "") {
  const params = new URLSearchParams({ start, end });
  if (employeeId) {
    params.set("employee_id", employeeId);
  }
  return request(`/justifications?${params.toString()}`);
}

export function getAbsenceBalances() {
  return request("/absence-balances");
}

export function getAbsenceBalanceStatus() {
  return request("/absence-balances/status");
}

export function getAbsenceBalance(employeeId) {
  return request(`/absence-balances/${employeeId}`);
}

export function updateAbsenceBalance(employeeId, payload) {
  return request(`/absence-balances/${employeeId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function commitAbsenceBalances(payload) {
  return request("/absence-balances/commit", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function exportAbsenceBalances() {
  return download("/absence-balances/export", "residui-assenze.xlsx");
}

export function createJustification(payload) {
  return request("/justifications", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateJustification(justificationId, payload) {
  return request(`/justifications/${justificationId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function updateJustificationApproval(justificationId, payload) {
  return request(`/justifications/${justificationId}/approval`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteJustification(justificationId) {
  return request(`/justifications/${justificationId}`, {
    method: "DELETE",
  });
}

export function getTeams() {
  return request("/teams");
}

export function createTeam(payload) {
  return request("/teams", { method: "POST", body: JSON.stringify(payload) });
}

export function updateTeam(teamId, payload) {
  return request(`/teams/${teamId}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteTeam(teamId) {
  return request(`/teams/${teamId}`, { method: "DELETE" });
}

export function addTeamMember(teamId, employeeId) {
  return request(`/teams/${teamId}/members`, { method: "POST", body: JSON.stringify({ employee_id: employeeId }) });
}

export function removeTeamMember(teamId, employeeId) {
  return request(`/teams/${teamId}/members/${employeeId}`, { method: "DELETE" });
}

export function getTeamDailyNotes(workDate) {
  return request(`/teams/daily-notes?work_date=${workDate}`);
}

export function upsertTeamDailyNote(teamId, workDate, workload) {
  return request(`/teams/${teamId}/daily-notes/${workDate}`, {
    method: "PUT",
    body: JSON.stringify({ workload: workload ?? null }),
  });
}

export function getWorkloadTeams(workDate) {
  return request(`/workloads/teams?work_date=${workDate}`);
}

export function upsertStructuredWorkload(teamId, workDate, payload) {
  return request(`/workloads/teams/${teamId}/daily-notes/${workDate}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getWorkloadCustomerSuppliers() {
  return request("/workloads/customer-suppliers");
}

export function importGesapBookingToWorkload(payload) {
  return request("/workloads/gesap/import", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function syncGesapWorkloads(workDate) {
  return request(`/workloads/gesap/sync?work_date=${workDate}`, { method: "POST" });
}

export function getAuditLogs({ entity = "", action = "", actor = "", search = "", start = "", end = "", limit = 100, offset = 0 } = {}) {
  const params = new URLSearchParams();
  if (entity) params.set("entity", entity);
  if (action) params.set("action", action);
  if (actor) params.set("actor", actor);
  if (search) params.set("search", search);
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return request(`/audit-logs?${params.toString()}`);
}

export function getAuditLogFilters() {
  return request("/audit-logs/filters");
}

export function getSystemStatus() {
  return request("/system/status");
}

export function getOffice365Integration() {
  return request("/system/integrations/office365");
}

// Il client secret non viene mai riletto dal server: ometterlo dal payload
// significa "lascia invariato quello salvato".
export function updateOffice365Integration(payload) {
  return request("/system/integrations/office365", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getGesapPrenotazioni(date) {
  return request(`/gesap/prenotazioni?data=${date}`);
}

export function getToolChanges() {
  return request("/tool-changes");
}

export function createToolChange(payload) {
  return request("/tool-changes", { method: "POST", body: JSON.stringify(payload) });
}

export function updateToolChange(changeId, payload) {
  return request(`/tool-changes/${changeId}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteToolChange(changeId) {
  return request(`/tool-changes/${changeId}`, { method: "DELETE" });
}

// ── Activity Records (admin portal) ──────────────────────────────────────────

export function getActivityRecordsAdmin({ employeeId = "", mappingId = "", startDate = "", endDate = "", limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (employeeId) params.set("employee_id", employeeId);
  if (mappingId) params.set("mapping_id", mappingId);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  if (limit !== 200) params.set("limit", String(limit));
  return request(`/activity-records/admin?${params.toString()}`);
}

export function getActivityRecordStats({ startDate = "", endDate = "" } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return request(`/activity-records/admin/stats?${params.toString()}`);
}

export function getActiveActivitiesAdmin({ startDate = "", endDate = "" } = {}) {
  const params = new URLSearchParams();
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  return request(`/activity-records/active/admin?${params.toString()}`);
}

export function closeActiveActivityAdmin(activityId, payload = {}) {
  return request(`/activity-records/active/admin/${activityId}/close`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function discardActiveActivityAdmin(activityId) {
  return request(`/activity-records/active/admin/${activityId}`, { method: "DELETE" });
}

export function updateActivityRecordAdmin(recordId, payload) {
  return request(`/activity-records/admin/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteActivityRecordAdmin(recordId) {
  return request(`/activity-records/admin/${recordId}`, { method: "DELETE" });
}

export function getDailyRecords({ employeeId = "", startDate = "", endDate = "", limit = 200 } = {}) {
  const params = new URLSearchParams();
  if (employeeId) params.set("employee_id", employeeId);
  if (startDate) params.set("start_date", startDate);
  if (endDate) params.set("end_date", endDate);
  params.set("limit", String(limit));
  return request(`/daily-records?${params.toString()}`);
}

export function updateDailyRecordAdmin(recordId, payload) {
  return request(`/daily-records/admin/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteDailyRecordAdmin(recordId) {
  return request(`/daily-records/admin/${recordId}`, { method: "DELETE" });
}

export function getOrgFunctions({ activeOnly = false } = {}) {
  const params = new URLSearchParams({ active_only: String(activeOnly) });
  return request(`/org-entities/functions?${params.toString()}`);
}

export function createOrgFunction(payload) {
  return request("/org-entities/functions", { method: "POST", body: JSON.stringify(payload) });
}

export function updateOrgFunction(id, payload) {
  return request(`/org-entities/functions/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteOrgFunction(id) {
  return request(`/org-entities/functions/${id}`, { method: "DELETE" });
}

export function getOrgDepartments({ activeOnly = false } = {}) {
  const params = new URLSearchParams({ active_only: String(activeOnly) });
  return request(`/org-entities/departments?${params.toString()}`);
}

export function createOrgDepartment(payload) {
  return request("/org-entities/departments", { method: "POST", body: JSON.stringify(payload) });
}

export function updateOrgDepartment(id, payload) {
  return request(`/org-entities/departments/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteOrgDepartment(id) {
  return request(`/org-entities/departments/${id}`, { method: "DELETE" });
}

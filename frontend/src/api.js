const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";
const TOKEN_STORAGE_KEY = "workforce-planner-token";
const AUTH_LOGOUT_EVENT = "workforce-planner-auth-logout";

let _impersonateEmployeeId = null;

export function setImpersonateEmployeeId(id) {
  _impersonateEmployeeId = id ?? null;
}

async function request(path, options = {}) {
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
      detail = payload.detail ?? detail;
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

export function getImpersonationView(employeeId) {
  return request(`/auth/impersonate/${employeeId}`);
}

export function getDashboard(date) {
  return request(`/dashboard?date=${date}`);
}

export function getDashboardMe(employeeId, date) {
  return request(`/dashboard/me?employee_id=${employeeId}&date=${date}`);
}

export function getDashboardApprover(employeeId) {
  return request(`/dashboard/approver?employee_id=${employeeId}`);
}

export function getEmployees(search = "", roles = []) {
  const params = new URLSearchParams({ active_only: "true" });
  if (search.trim()) {
    params.set("search", search.trim());
  }
  for (const role of roles) {
    params.append("roles", role);
  }
  return request(`/employees?${params.toString()}`);
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

export function syncEmployees() {
  return request("/employees/sync", { method: "POST" });
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

export function getJustifications(start, end, employeeId = "") {
  const params = new URLSearchParams({ start, end });
  if (employeeId) {
    params.set("employee_id", employeeId);
  }
  return request(`/justifications?${params.toString()}`);
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

export function getTimesheetDashboard(day) {
  return request(`/timesheets/dashboard?day=${day}`);
}

export function getTimesheetStats(start, end) {
  return request(`/timesheets/stats?start=${start}&end=${end}`);
}

export function getTimesheetFilters(start = "", end = "") {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return request(`/timesheets/filters?${params.toString()}`);
}

export function getTimesheets({ start = "", end = "", workerId = "", department = "", project = "", costCenter = "", status = "", approvalStatus = "", search = "" } = {}) {
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (workerId) params.set("worker_id", workerId);
  if (department) params.set("department", department);
  if (project) params.set("project", project);
  if (costCenter) params.set("cost_center", costCenter);
  if (status) params.set("status", status);
  if (approvalStatus) params.set("approval_status", approvalStatus);
  if (search.trim()) params.set("search", search.trim());
  return request(`/timesheets?${params.toString()}`);
}

export async function exportTimesheetsCsv({ start = "", end = "", workerId = "", department = "", project = "", costCenter = "", status = "", approvalStatus = "", search = "" } = {}) {
  const token = getAccessToken();
  const params = new URLSearchParams();
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  if (workerId) params.set("worker_id", workerId);
  if (department) params.set("department", department);
  if (project) params.set("project", project);
  if (costCenter) params.set("cost_center", costCenter);
  if (status) params.set("status", status);
  if (approvalStatus) params.set("approval_status", approvalStatus);
  if (search.trim()) params.set("search", search.trim());

  const response = await fetch(`${API_BASE_URL}/timesheets/export?${params.toString()}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    if (response.status === 401) clearAccessToken();
    throw new Error(response.statusText || "Export failed");
  }

  return response.blob();
}

export function getTimesheetDetail(dayId) {
  return request(`/timesheets/${dayId}`);
}

export function approveTimesheet(dayId, payload) {
  return request(`/timesheets/${dayId}/approve`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function requestTimesheetCorrection(dayId, payload) {
  return request(`/timesheets/${dayId}/request-correction`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function manualUpdateTimesheet(dayId, payload) {
  return request(`/timesheets/${dayId}/manual-update`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function getTimesheetAdminOverview() {
  return request("/timesheets/admin/overview");
}

export function getTimesheetSyncRuns() {
  return request("/timesheets/admin/sync-runs");
}

export function getTimesheetProjects() {
  return request("/timesheets/admin/projects");
}

export function getTimesheetWorkers(search = "") {
  const params = new URLSearchParams();
  if (search.trim()) params.set("search", search.trim());
  return request(`/timesheets/admin/workers?${params.toString()}`);
}

export function runTimesheetManualSync() {
  return request("/timesheets/admin/sync", { method: "POST" });
}

export function updateTimesheetWorkerEmployeeLink(workerId, payload) {
  return request(`/timesheets/admin/workers/${workerId}/employee-link`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteTimesheetWorker(workerId) {
  return request(`/timesheets/admin/workers/${workerId}`, {
    method: "DELETE",
  });
}

export function updateTimesheetProjectLink(externalKey, payload) {
  return request(`/timesheets/admin/projects/${encodeURIComponent(externalKey)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getTimesheetCostCenters() {
  return request("/timesheets/admin/cost-centers");
}

export function updateTimesheetCostCenterLink(externalKey, payload) {
  return request(`/timesheets/admin/cost-centers/${encodeURIComponent(externalKey)}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function getTimesheetMappings(mappingType = "") {
  const params = new URLSearchParams();
  if (mappingType) params.set("mapping_type", mappingType);
  return request(`/timesheets/admin/mappings?${params.toString()}`);
}

export function createTimesheetMapping(payload) {
  return request("/timesheets/admin/mappings", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateTimesheetMapping(mappingId, payload) {
  return request(`/timesheets/admin/mappings/${mappingId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteTimesheetMapping(mappingId) {
  return request(`/timesheets/admin/mappings/${mappingId}`, {
    method: "DELETE",
  });
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

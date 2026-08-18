import { request } from "./api";

export function getOperationalReportingDay(day) {
  return request(`/operational-reporting/day?day=${encodeURIComponent(day)}`);
}

export function getOperationalReportingDashboard(startDate, endDate, filters = {}) {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  for (const [key, value] of Object.entries(filters)) {
    if (value) params.set(key, value);
  }
  return request(`/operational-reporting/dashboard?${params.toString()}`);
}

export function getOperationalReportingCustomers(areaId, building) {
  const params = new URLSearchParams({ area_id: areaId });
  if (building) params.set("building", building);
  return request(`/operational-reporting/customers?${params.toString()}`);
}

export function saveOperationalReportingDay(payload) {
  return request("/operational-reporting/day", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function confirmOperationalReportingDay(reportId) {
  return request(`/operational-reporting/${reportId}/confirm`, { method: "POST" });
}

export function resetOperationalReportingDay(day) {
  const params = new URLSearchParams({ day });
  return request(`/operational-reporting/day/reset?${params.toString()}`, { method: "POST" });
}

export function resetOperationalReportingMember(day, employeeId) {
  const params = new URLSearchParams({ day, employee_id: employeeId });
  return request(`/operational-reporting/day/reset-member?${params.toString()}`, { method: "POST" });
}

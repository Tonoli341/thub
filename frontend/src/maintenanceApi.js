import { request } from "./api";


export function getMaintenanceQuestionnaire() {
  return request("/maintenance/questionnaire");
}

export function saveMaintenanceQuestionnaire(payload) {
  return request("/maintenance/questionnaire", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

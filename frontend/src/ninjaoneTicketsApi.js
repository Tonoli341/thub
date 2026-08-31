import { request } from "./api";

export function getNinjaOneTickets() {
  return request("/ninjaone/tickets");
}

export function createNinjaOneTicket(payload) {
  return request("/ninjaone/tickets", { method: "POST", body: JSON.stringify(payload) });
}

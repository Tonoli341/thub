import { request } from "./api";

export function getNotifications() {
  return request("/notifications");
}

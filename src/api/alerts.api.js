import { http } from "./http.js";

export const alertsApi = {
  listByClient: (clientId) => http.get(`/api/alerts/client/${clientId}`),
  /** status: "acknowledged" | "resolved" */
  updateStatus: (alertId, status) => http.patch(`/api/alerts/${alertId}`, { status }),
};

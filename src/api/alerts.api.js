import { http, withQuery } from "./http.js";

export const alertsApi = {
  /** Paginado por cursor: { items, nextCursor }. */
  listByClient: (clientId, { cursor, limit } = {}) =>
    http.get(withQuery(`/api/alerts/client/${clientId}`, { cursor, limit })),
  /** status: "acknowledged" | "resolved" */
  updateStatus: (alertId, status) => http.patch(`/api/alerts/${alertId}`, { status }),
};

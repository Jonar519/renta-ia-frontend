import { http } from "./http.js";

export const alertsApi = {
  listByClient: (clientId) => http.get(`/api/alerts/client/${clientId}`),
};

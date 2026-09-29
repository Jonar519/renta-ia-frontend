import { http, withQuery } from "./http.js";

export const metricsApi = {
  /** Solo admin: p75 por métrica y ruta. { days, device, rows: [{ metric, route, samples, p75 }] } */
  webVitalsSummary: ({ days, device } = {}) => http.get(withQuery("/api/metrics/web-vitals/summary", { days, device })),
};

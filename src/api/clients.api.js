import { http, LONG_TIMEOUT_MS, withQuery } from "./http.js";

export const clientsApi = {
  /** Paginado por cursor: { items, nextCursor }. */
  list: ({ cursor, limit } = {}) => http.get(withQuery("/api/clients", { cursor, limit })),
  create: (data) => http.post("/api/clients", data),
  getById: (id) => http.get(`/api/clients/${id}`),
  update: (id, data) => http.patch(`/api/clients/${id}`, data),
  remove: (id) => http.delete(`/api/clients/${id}`),
  getTaxConcepts: (id) => http.get(`/api/clients/${id}/tax-concepts`),
  // Incluye una llamada al LLM para redactar el texto.
  summary: (id, periodYear) =>
    http.post(`/api/clients/${id}/summary`, periodYear ? { periodYear } : {}, { timeoutMs: LONG_TIMEOUT_MS }),
};

import { http, LONG_TIMEOUT_MS, withQuery } from "./http.js";

export const documentsApi = {
  /** Paginado por cursor: { items, nextCursor }. */
  listByClient: (clientId, { cursor, limit } = {}) =>
    http.get(withQuery(`/api/documents/client/${clientId}`, { cursor, limit })),
  getById: (id) => http.get(`/api/documents/${id}`),
  /** ¿El cliente ya tiene un archivo con esta huella? { exists, document } */
  findByHash: (clientId, sha256) => http.get(`/api/documents/client/${clientId}/by-hash/${sha256}`),
  // Archivos de hasta 15 MB: en conexiones lentas la subida tarda.
  upload: (formData) => http.postForm("/api/documents/upload", formData, { timeoutMs: LONG_TIMEOUT_MS }),
  reprocess: (id) => http.post(`/api/documents/${id}/reprocess`),
};

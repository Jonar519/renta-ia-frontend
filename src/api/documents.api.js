import { http, LONG_TIMEOUT_MS } from "./http.js";

export const documentsApi = {
  listByClient: (clientId) => http.get(`/api/documents/client/${clientId}`),
  getById: (id) => http.get(`/api/documents/${id}`),
  // Archivos de hasta 15 MB: en conexiones lentas la subida tarda.
  upload: (formData) => http.postForm("/api/documents/upload", formData, { timeoutMs: LONG_TIMEOUT_MS }),
};

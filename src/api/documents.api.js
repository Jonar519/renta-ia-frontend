import { http } from "./http.js";

export const documentsApi = {
  listByClient: (clientId) => http.get(`/api/documents/client/${clientId}`),
  getById: (id) => http.get(`/api/documents/${id}`),
  upload: (formData) => http.postForm("/api/documents/upload", formData),
};

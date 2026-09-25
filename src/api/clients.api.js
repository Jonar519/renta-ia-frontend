import { http } from "./http.js";

export const clientsApi = {
  list: () => http.get("/api/clients"),
  create: (data) => http.post("/api/clients", data),
  getById: (id) => http.get(`/api/clients/${id}`),
  update: (id, data) => http.patch(`/api/clients/${id}`, data),
  remove: (id) => http.delete(`/api/clients/${id}`),
  getTaxConcepts: (id) => http.get(`/api/clients/${id}/tax-concepts`),
};

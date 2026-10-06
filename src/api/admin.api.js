import { http, withQuery } from "./http.js";

/** Administración de cuentas (solo admin; la API responde 403 a los demás roles). */
export const adminApi = {
  listInvitations: () => http.get("/api/admin/invitations"),
  invite: (data) => http.post("/api/admin/invitations", data),
  resendInvitation: (userId) => http.post(`/api/admin/invitations/${encodeURIComponent(userId)}/resend`),
  cancelInvitation: (userId) => http.delete(`/api/admin/invitations/${encodeURIComponent(userId)}`),
  accountants: () => http.get("/api/admin/accountants"),
  portalClients: (q) => http.get(withQuery("/api/admin/portal-clients", { q: q || undefined })),
};

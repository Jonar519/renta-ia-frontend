import { http } from "./http.js";

/** La propia cuenta (renta-ia-backend: /api/users/me). */
export const usersApi = {
  me: () => http.get("/api/users/me"),
  update: (data) => http.patch("/api/users/me", data),
  requestEmailChange: (newEmail, password) => http.post("/api/users/me/email", { newEmail, password }),
  cancelEmailChange: () => http.delete("/api/users/me/email"),
  changePassword: (currentPassword, newPassword) =>
    http.post("/api/users/me/password", { currentPassword, newPassword }),
  // Sesiones activas (B13).
  sessions: () => http.get("/api/users/me/sessions"),
  closeSession: (id) => http.delete(`/api/users/me/sessions/${encodeURIComponent(id)}`),
  closeOtherSessions: () => http.delete("/api/users/me/sessions"),
  // Tus datos (B14).
  exportData: (password) => http.post("/api/users/me/export", { password }),
  deletionStatus: () => http.get("/api/users/me/deletion"),
  deleteAccount: (password, code) => http.post("/api/users/me/deletion", { password, code }),
};

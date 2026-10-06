import { http } from "./http.js";

/** La propia cuenta (renta-ia-backend: /api/users/me). */
export const usersApi = {
  me: () => http.get("/api/users/me"),
  update: (data) => http.patch("/api/users/me", data),
  requestEmailChange: (newEmail, password) => http.post("/api/users/me/email", { newEmail, password }),
  cancelEmailChange: () => http.delete("/api/users/me/email"),
  changePassword: (currentPassword, newPassword) =>
    http.post("/api/users/me/password", { currentPassword, newPassword }),
};

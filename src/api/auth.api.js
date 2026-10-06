import { http } from "./http.js";

export const authApi = {
  login: (data) => http.post("/api/auth/login", data),
  /** El token va en el cuerpo, nunca en la URL (las URL quedan en logs). */
  lookupInvitation: (token) => http.post("/api/auth/invitations/lookup", { token }),
  acceptInvitation: (token, password) => http.post("/api/auth/invitations/accept", { token, password }),
  /** Responde siempre lo mismo, exista o no el correo. */
  requestPasswordReset: (email) => http.post("/api/auth/password-reset/request", { email }),
  lookupPasswordReset: (token) => http.post("/api/auth/password-reset/lookup", { token }),
  confirmPasswordReset: (token, password) => http.post("/api/auth/password-reset/confirm", { token, password }),
};

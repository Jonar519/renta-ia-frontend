import { http } from "./http.js";

export const authApi = {
  login: (data) => http.post("/api/auth/login", data),
  /** El token va en el cuerpo, nunca en la URL (las URL quedan en logs). */
  lookupInvitation: (token) => http.post("/api/auth/invitations/lookup", { token }),
  acceptInvitation: (token, password) => http.post("/api/auth/invitations/accept", { token, password }),
};

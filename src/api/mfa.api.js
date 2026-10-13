import { http } from "./http.js";

/** Verificación en dos pasos de la propia cuenta (renta-ia-backend: /api/users/me/mfa). */
const BASE = "/api/users/me/mfa";
export const mfaApi = {
  status: () => http.get(BASE),
  setup: (password) => http.post(`${BASE}/setup`, { password }),
  enable: (code) => http.post(`${BASE}/enable`, { code }),
  disable: (password, code) => http.post(`${BASE}/disable`, { password, code }),
  regenerateCodes: (code) => http.post(`${BASE}/recovery-codes`, { code }),
};

import { http } from "./http.js";

export const authApi = {
  register: (data) => http.post("/api/auth/register", data),
  login: (data) => http.post("/api/auth/login", data),
};

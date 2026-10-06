import { http } from "./http.js";

export const authApi = {
  login: (data) => http.post("/api/auth/login", data),
};

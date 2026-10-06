import { http } from "./http.js";

export const usersApi = {
  me: () => http.get("/api/users/me"),
};

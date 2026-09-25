import { http } from "./http.js";

export const aiApi = {
  chat: (clientId, question) => http.post("/api/ai/chat", { clientId, question }),
};

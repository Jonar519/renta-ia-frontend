import { http, LONG_TIMEOUT_MS } from "./http.js";

export const aiApi = {
  // La respuesta del LLM puede tardar bastante más que una petición normal.
  chat: (clientId, question) => http.post("/api/ai/chat", { clientId, question }, { timeoutMs: LONG_TIMEOUT_MS }),
};

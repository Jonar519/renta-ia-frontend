import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  http,
  DEFAULT_TIMEOUT_MS,
  NETWORK_ERROR_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  TIMEOUT_ERROR_MESSAGE,
} from "../src/api/http.js";
import { getState, setAuth } from "../src/state/store.js";

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("http.js", () => {
  beforeEach(() => {
    localStorage.clear();
    window.location.hash = "/";
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("envía el token y devuelve el JSON en una respuesta exitosa", async () => {
    setAuth("token-abc", { id: "1", name: "Ana" });
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, [{ id: "c1" }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/api/clients")).resolves.toEqual([{ id: "c1" }]);
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer token-abc");
  });

  it("un 401 con sesión activa limpia la sesión (store y localStorage) y redirige al login", async () => {
    setAuth("token-vencido", { id: "1", name: "Ana" });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Token inválido o expirado" })));

    await expect(http.get("/api/clients")).rejects.toThrow(SESSION_EXPIRED_MESSAGE);
    expect(getState().token).toBeNull();
    expect(getState().user).toBeNull();
    expect(localStorage.getItem("renta_ia_token")).toBeNull();
    expect(window.location.hash).toBe("#/login");
  });

  it("un 401 sin sesión (login incorrecto) muestra el mensaje del servidor", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(401, { error: "Credenciales inválidas" })));
    await expect(http.post("/api/auth/login", { email: "a@b.co", password: "x" })).rejects.toThrow(
      "Credenciales inválidas"
    );
  });

  it("un error de red muestra un mensaje legible en español, no el error crudo del navegador", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    const error = await http.get("/api/clients").catch((e) => e);
    expect(error.message).toBe(NETWORK_ERROR_MESSAGE);
    expect(error.message).not.toMatch(/Failed to fetch/);
  });

  it("si el servidor no responde a tiempo, aborta y muestra un mensaje de timeout", async () => {
    vi.useFakeTimers();
    // fetch que nunca responde, salvo que se aborte con el AbortSignal.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener("abort", () =>
              reject(new DOMException("The user aborted a request.", "AbortError"))
            );
          })
      )
    );

    const pending = http.get("/api/clients").catch((e) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_TIMEOUT_MS);
    const error = await pending;
    expect(error.message).toBe(TIMEOUT_ERROR_MESSAGE);
  });

  it("agrega los detalles de validación del backend al mensaje", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(400, {
          error: "Datos inválidos",
          details: [{ field: "body.question", message: "Campo requerido" }],
        })
      )
    );
    await expect(http.post("/api/ai/chat", {})).rejects.toThrow("Datos inválidos — question: Campo requerido");
  });

  it("un 5xx sin JSON (ej. proxy caído) da un mensaje legible", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<html>Bad Gateway</html>", { status: 502 })));
    await expect(http.get("/api/clients")).rejects.toThrow("El servidor tuvo un problema (502)");
  });
});

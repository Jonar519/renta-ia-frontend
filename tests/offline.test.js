import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  OFFLINE_TTL_MS,
  clearOfflineData,
  isOfflineCacheable,
  readOfflineResponse,
  saveOfflineResponse,
} from "../src/offline/offlineStore.js";
import { formatAge } from "../src/offline/connectivity.js";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";
const CLIENT = "aaaaaaaa-0000-0000-0000-000000000001";

describe("offlineStore (IndexedDB)", () => {
  beforeEach(() => clearOfflineData());

  it("solo guarda lecturas permitidas: clientes y documentos, NUNCA montos, resúmenes ni chat", () => {
    expect(isOfflineCacheable("/api/clients?limit=50")).toBe(true);
    expect(isOfflineCacheable(`/api/clients/${CLIENT}`)).toBe(true);
    expect(isOfflineCacheable(`/api/documents/client/${CLIENT}?cursor=x`)).toBe(true);
    expect(isOfflineCacheable(`/api/clients/${CLIENT}/tax-concepts`)).toBe(false);
    expect(isOfflineCacheable(`/api/clients/${CLIENT}/summary`)).toBe(false);
    expect(isOfflineCacheable(`/api/alerts/client/${CLIENT}`)).toBe(false);
    expect(isOfflineCacheable("/api/ai/chat")).toBe(false);
  });

  it("guarda y lee por usuario: los datos de A no los ve B", async () => {
    await saveOfflineResponse(A, "/api/clients", { items: ["de A"] }, 1000);
    expect(await readOfflineResponse(A, "/api/clients", 2000)).toEqual({
      key: "/api/clients",
      data: { items: ["de A"] },
      savedAt: 1000,
    });
    expect(await readOfflineResponse(B, "/api/clients", 2000)).toBeNull();
  });

  it("caduca a las 24 h (y borra la entrada vencida)", async () => {
    await saveOfflineResponse(A, "/api/clients", { items: [] }, 0);
    expect(await readOfflineResponse(A, "/api/clients", OFFLINE_TTL_MS)).not.toBeNull();
    expect(await readOfflineResponse(A, "/api/clients", OFFLINE_TTL_MS + 1)).toBeNull();
    expect(await readOfflineResponse(A, "/api/clients", 1)).toBeNull(); // ya se borró
  });

  it("al cerrar sesión se borra todo; al entrar otro usuario, se borran los demás", async () => {
    await saveOfflineResponse(A, "/api/clients", { items: ["A"] });
    await saveOfflineResponse(B, "/api/clients", { items: ["B"] });

    await clearOfflineData({ keepUserId: B }); // entra B
    expect(await readOfflineResponse(A, "/api/clients")).toBeNull();
    expect(await readOfflineResponse(B, "/api/clients")).not.toBeNull();

    await clearOfflineData(); // logout
    expect(await readOfflineResponse(B, "/api/clients")).toBeNull();
  });
});

describe("http.js: reintentos, cancelación y respaldo offline", () => {
  let http;
  let setAuth;
  let routeController;
  let connectivity;

  beforeEach(async () => {
    vi.resetModules();
    routeController = new AbortController();
    vi.doMock("../src/router.js", () => ({ getRouteSignal: () => routeController.signal }));
    ({ http } = await import("../src/api/http.js"));
    ({ setAuth } = await import("../src/state/store.js"));
    // Misma instancia de módulo que usa http.js (tras resetModules).
    connectivity = await import("../src/offline/connectivity.js");
    setAuth("token", { id: A, name: "Ana" });
    await clearOfflineData({ keepUserId: A });
    connectivity.setOnline(true);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.doUnmock("../src/router.js");
  });

  const json = (status, body) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

  it("un GET se reintenta tras un error de red (backoff) y termina bien", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = http.get("/api/users/me");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("un 503 se reintenta; un 429 respeta Retry-After", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(503, { error: "caído" }))
      .mockResolvedValueOnce(
        new Response("{}", { status: 429, headers: { "Retry-After": "3", "Content-Type": "application/json" } })
      )
      .mockResolvedValueOnce(json(200, { ok: 1 }));
    vi.stubGlobal("fetch", fetchMock);
    const pending = http.get("/api/users/me");
    await vi.advanceTimersByTimeAsync(600); // backoff del 1er reintento: entre 250 y 500 ms
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // 2.º intento en t ∈ [250, 500] ms → el 3.º en t + 3000 ∈ [3250, 3500] ms.
    await vi.advanceTimersByTimeAsync(2300); // t = 2900
    expect(fetchMock).toHaveBeenCalledTimes(2); // todavía esperando los 3 s de Retry-After
    await vi.advanceTimersByTimeAsync(700); // t = 3600
    await expect(pending).resolves.toEqual({ ok: 1 });
  });

  it("un POST NO se reintenta (no es idempotente)", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));
    vi.stubGlobal("fetch", fetchMock);
    const pending = http.post("/api/clients", { fullName: "X" }).catch((e) => e);
    await vi.runAllTimersAsync();
    expect((await pending).kind).toBe("network");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin conexión, las escrituras se rechazan sin llegar a la red", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("navigator", { onLine: false });
    await expect(http.post("/api/clients", {})).rejects.toMatchObject({ kind: "offline" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("al cambiar de vista se cancelan los GET en vuelo (AbortError, sin reintentos)", async () => {
    const fetchMock = vi.fn(
      (_url, { signal }) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new DOMException("x", "AbortError")))
        )
    );
    vi.stubGlobal("fetch", fetchMock);
    const pending = http.get("/api/clients").catch((e) => e);
    routeController.abort();
    const error = await pending;
    expect(error.name).toBe("AbortError");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("sin red, una lectura guardada se sirve desde IndexedDB y se marca como datos viejos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(json(200, { items: [{ id: "c1" }], nextCursor: null })));
    await http.get("/api/clients");
    await vi.runAllTimersAsync(); // deja terminar el guardado en IndexedDB

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const pending = http.get("/api/clients");
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toEqual({ items: [{ id: "c1" }], nextCursor: null });
    expect(connectivity.getConnectivity()).toMatchObject({ online: false, staleSince: expect.any(Number) });
  });

  it("los conceptos (montos) nunca se sirven desde la caché offline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const pending = http.get(`/api/clients/${CLIENT}/tax-concepts`).catch((e) => e);
    await vi.runAllTimersAsync();
    expect((await pending).kind).toBe("network");
  });
});

describe("formatAge", () => {
  it("formatea en español", () => {
    expect(formatAge(0, 20_000)).toBe("hace menos de un minuto");
    expect(formatAge(0, 5 * 60000)).toBe("hace 5 minutos");
    expect(formatAge(0, 3 * 3600000)).toBe("hace 3 horas");
    expect(formatAge(0, 2 * 86400000)).toBe("anteayer"); // numeric: "auto"
    expect(formatAge(0, 5 * 86400000)).toBe("hace 5 días");
  });
});

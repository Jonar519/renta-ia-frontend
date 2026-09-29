import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Sesión en el navegador (renta-ia-backend/docs/adr/0007-esquema-de-sesion.md): access token
 * solo en memoria, refresh con cookie httpOnly (que aquí no se ve: la maneja
 * el navegador), renovación single-flight y cierre de sesión en el servidor.
 */

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const USER = { id: "11111111-1111-1111-1111-111111111111", name: "Ana", email: "ana@x.co", role: "accountant" };

/** JWT de prueba (sin firma válida: el navegador no la verifica) con exp en ms dados. */
function fakeJwt(expMs) {
  const b64 = (o) => btoa(JSON.stringify(o)).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64({ alg: "HS256" })}.${b64({ userId: USER.id, exp: Math.floor(expMs / 1000) })}.firma`;
}

let http;
let store;
let session;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  window.location.hash = "/";
  ({ http } = await import("../src/api/http.js"));
  store = await import("../src/state/store.js");
  session = await import("../src/auth/session.js");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("store: el token nunca se persiste", () => {
  it("setAuth deja el access token solo en memoria; en localStorage queda una pista sin secretos", () => {
    store.setAuth("secreto.jwt.token", USER);
    const everything = JSON.stringify({ ...localStorage });
    expect(everything).not.toContain("secreto.jwt.token");
    expect(JSON.parse(localStorage.getItem("renta_ia_session"))).toEqual({
      id: USER.id,
      name: USER.name,
      role: USER.role,
    });
  });

  it("borra las claves del esquema anterior (JWT en localStorage)", async () => {
    localStorage.setItem("renta_ia_token", "jwt-viejo");
    localStorage.setItem("renta_ia_user", JSON.stringify(USER));
    vi.resetModules();
    const fresh = await import("../src/state/store.js");
    expect(localStorage.getItem("renta_ia_token")).toBeNull();
    expect(localStorage.getItem("renta_ia_user")).toBeNull();
    expect(fresh.getState().token).toBeNull();
  });
});

describe("login y rutas de autenticación", () => {
  it("/api/auth/* viaja con credenciales (cookie) y el encabezado anti-CSRF; el resto no", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { accessToken: "a1", user: USER }))
      .mockResolvedValueOnce(json(200, { items: [] }));
    vi.stubGlobal("fetch", fetchMock);

    session.startSession(await http.post("/api/auth/login", { email: USER.email, password: "x" }));
    await http.get("/api/clients");

    const [, loginInit] = fetchMock.mock.calls[0];
    expect(loginInit.credentials).toBe("include");
    expect(loginInit.headers["X-Requested-With"]).toBe("renta-ia");
    const [, apiInit] = fetchMock.mock.calls[1];
    expect(apiInit.credentials).toBe("same-origin");
    expect(apiInit.headers.Authorization).toBe("Bearer a1");
  });
});

describe("renovación del access token", () => {
  it("ante un 401 renueva UNA vez con la cookie y repite la petición", async () => {
    store.setAuth("vencido", USER);
    const fetchMock = vi.fn(async (url, init) => {
      if (url.endsWith("/api/auth/refresh")) return json(200, { accessToken: "nuevo", user: USER });
      return init.headers.Authorization === "Bearer nuevo" ? json(200, { ok: 1 }) : json(401, { error: "exp" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(http.get("/api/clients")).resolves.toEqual({ ok: 1 });
    const refreshCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/refresh"));
    expect(refreshCall[1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(refreshCall[1].headers["X-Requested-With"]).toBe("renta-ia");
    expect(store.getState().token).toBe("nuevo");
  });

  it("varias peticiones con 401 simultáneos comparten un solo /refresh (single-flight)", async () => {
    store.setAuth("vencido", USER);
    const fetchMock = vi.fn(async (url, init) => {
      if (url.endsWith("/api/auth/refresh")) {
        await new Promise((r) => setTimeout(r, 20));
        return json(200, { accessToken: "nuevo", user: USER });
      }
      return init.headers.Authorization === "Bearer nuevo" ? json(200, { url }) : json(401, { error: "exp" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await Promise.all([http.get("/api/clients"), http.get("/api/alerts/client/x"), http.get("/api/users/me")]);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith("/refresh"))).toHaveLength(1);
  });

  it("un 409 (otra pestaña rotó la cookie a la vez) se reintenta y la sesión sigue", async () => {
    store.setAuth("vencido", USER);
    let refreshes = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url, init) => {
        if (url.endsWith("/refresh")) {
          refreshes += 1;
          return refreshes === 1 ? json(409, { error: "carrera" }) : json(200, { accessToken: "nuevo", user: USER });
        }
        return init.headers.Authorization === "Bearer nuevo" ? json(200, { ok: 1 }) : json(401, {});
      })
    );
    await expect(http.get("/api/clients")).resolves.toEqual({ ok: 1 });
    expect(refreshes).toBe(2);
  });

  it("si la renovación falla (sesión revocada), se cierra la sesión local y se va al login", async () => {
    store.setAuth("vencido", USER);
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(json(401, { error: "Sesión inválida" })));
    await expect(http.get("/api/clients")).rejects.toThrow(/sesión expiró/);
    expect(store.getState().token).toBeNull();
    expect(localStorage.getItem("renta_ia_session")).toBeNull();
    expect(window.location.hash).toBe("#/login");
  });

  it("al abrir la app con pista de sesión, las primeras peticiones esperan el refresh (sin 401 de más)", async () => {
    localStorage.setItem("renta_ia_session", JSON.stringify({ id: USER.id, name: USER.name, role: USER.role }));
    vi.resetModules();
    ({ http } = await import("../src/api/http.js"));
    session = await import("../src/auth/session.js");
    store = await import("../src/state/store.js");

    const fetchMock = vi.fn(async (url, init) => {
      if (url.endsWith("/refresh")) return json(200, { accessToken: "restaurado", user: USER });
      return init.headers.Authorization === "Bearer restaurado" ? json(200, { ok: 1 }) : json(401, {});
    });
    vi.stubGlobal("fetch", fetchMock);

    const restoring = session.restoreSession();
    await expect(http.get("/api/clients")).resolves.toEqual({ ok: 1 });
    await restoring;
    expect(fetchMock.mock.calls.map(([url]) => url.replace(/^https?:\/\/[^/]+/, ""))).toEqual([
      "/api/auth/refresh",
      "/api/clients",
    ]);
    expect(store.getState().user.email).toBe(USER.email);
  });

  it("renueva de forma proactiva un minuto antes de que venza el token", async () => {
    vi.useFakeTimers({ now: 0 });
    const fetchMock = vi.fn().mockResolvedValue(json(200, { accessToken: fakeJwt(30 * 60_000), user: USER }));
    vi.stubGlobal("fetch", fetchMock);
    session.startSession({ accessToken: fakeJwt(15 * 60_000), user: USER });

    await vi.advanceTimersByTimeAsync(13 * 60_000);
    expect(fetchMock).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(60_000 + 10);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/refresh$/);
  });
});

describe("logout", () => {
  it("revoca la sesión en el servidor y limpia el estado local", async () => {
    session.startSession({ accessToken: "a1", user: USER });
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await session.logout();
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/auth\/logout$/);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: "POST", credentials: "include" });
    expect(store.getState()).toMatchObject({ token: null, user: null });
    expect(localStorage.getItem("renta_ia_session")).toBeNull();
  });

  it("sin conexión igual cierra la sesión local", async () => {
    session.startSession({ accessToken: "a1", user: USER });
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    await session.logout();
    expect(store.getState().token).toBeNull();
  });
});

describe("permisos de la interfaz por rol", () => {
  it("assistant no crea clientes; client es de solo lectura", async () => {
    const { can } = await import("../src/auth/permissions.js");
    const as = (role) => ({ ...USER, role });
    expect(can("client.create", as("accountant"))).toBe(true);
    expect(can("client.create", as("assistant"))).toBe(false);
    expect(can("document.write", as("assistant"))).toBe(true);
    for (const action of ["client.create", "document.write", "alert.update", "ai.use"]) {
      expect(can(action, as("client"))).toBe(false);
    }
    expect(can("ai.use", null)).toBe(false);
  });
});

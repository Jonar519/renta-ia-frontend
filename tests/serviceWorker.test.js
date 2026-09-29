import fs from "fs";
import vm from "vm";
import { describe, expect, it, vi } from "vitest";

const ORIGIN = "http://localhost:4173";
const PRECACHE = ["/index.html", "/offline.html", "/favicon.svg", "/assets/app-abc123.js"];

/** Cache Storage en memoria con la misma API que la real. */
function createCaches(initial = {}) {
  const stores = new Map(Object.entries(initial).map(([name, entries]) => [name, new Map(Object.entries(entries))]));
  const keyOf = (req) => (typeof req === "string" ? new URL(req, ORIGIN).pathname : new URL(req.url).pathname);
  const open = async (name) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name);
    return {
      // Como la Cache API real: una respuesta con "Vary" no coincide con una
      // petición con otras cabeceras, salvo que se pida ignoreVary.
      match: async (req, options = {}) => {
        const res = store.get(keyOf(req));
        if (!res) return undefined;
        if (res.headers.get("vary") && typeof req !== "string" && !options.ignoreVary) return undefined;
        return res.clone();
      },
      put: async (req, res) => void store.set(keyOf(req), res),
      addAll: async (urls) => urls.forEach((u) => store.set(u, new Response(`precache ${u}`))),
    };
  };
  return {
    stores,
    api: {
      open,
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
      match: async (req) => {
        for (const store of stores.values()) if (store.has(keyOf(req))) return store.get(keyOf(req)).clone();
        return undefined;
      },
    },
  };
}

/** Carga el SW con los reemplazos que hace vite.config.js en el build. */
function loadServiceWorker({ buildId = "build2", caches = createCaches(), fetchImpl = vi.fn() } = {}) {
  const handlers = {};
  const postMessage = vi.fn();
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn(), matchAll: async () => [{ postMessage }] },
  };
  const code = fs
    .readFileSync("src/sw/service-worker.js", "utf8")
    .replace('const BUILD_ID = "__BUILD_ID__";', `const BUILD_ID = "${buildId}";`)
    .replace("const PRECACHE_URLS = __PRECACHE_URLS__;", `const PRECACHE_URLS = ${JSON.stringify(PRECACHE)};`);
  vm.runInNewContext(code, { self, caches: caches.api, URL, Promise, Response, fetch: fetchImpl, console });
  return { handlers, self, caches, postMessage, fetchImpl };
}

function fetchEvent(path, { method = "GET", mode = "cors", origin = ORIGIN } = {}) {
  const waits = [];
  return {
    request: { url: `${origin}${path}`, method, mode },
    respondWith: vi.fn(),
    waitUntil: (p) => waits.push(p),
    settled: () => Promise.all(waits),
  };
}

describe("service-worker.js", () => {
  it("la API y otros orígenes NO se interceptan (network-only: nada se cachea)", () => {
    const { handlers } = loadServiceWorker();
    for (const event of [
      fetchEvent("/api/clients/123/tax-concepts", { origin: "http://localhost:4000" }),
      fetchEvent("/api/documents/client/1"),
      fetchEvent("/index.html", { method: "POST" }),
    ]) {
      handlers.fetch(event);
      expect(event.respondWith).not.toHaveBeenCalled();
    }
  });

  it("instala precacheando el build SIN activarse sola (espera a que el usuario acepte recargar)", async () => {
    const sw = loadServiceWorker();
    let done;
    sw.handlers.install({ waitUntil: (p) => (done = p) });
    await done;
    expect([...sw.caches.stores.get("renta-ia-build2").keys()]).toEqual(PRECACHE);
    expect(sw.self.skipWaiting).not.toHaveBeenCalled();

    sw.handlers.message({ data: { type: "SKIP_WAITING" } });
    expect(sw.self.skipWaiting).toHaveBeenCalled();
  });

  it("al activarse borra las cachés de builds anteriores y las de versiones viejas del SW", async () => {
    const caches = createCaches({ "renta-ia-build1": {}, "renta-ia-build2": {}, "renta-ia-cache-v2": {}, otra: {} });
    const sw = loadServiceWorker({ caches });
    let done;
    sw.handlers.activate({ waitUntil: (p) => (done = p) });
    await done;
    expect([...caches.stores.keys()].sort()).toEqual(["otra", "renta-ia-build2"]);
  });

  it("assets con hash: cache-first (no vuelve a la red si ya está)", async () => {
    const caches = createCaches({ "renta-ia-build2": { "/assets/app-abc123.js": new Response("js en caché") } });
    const sw = loadServiceWorker({ caches });
    const event = fetchEvent("/assets/app-abc123.js");
    sw.handlers.fetch(event);
    const response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("js en caché");
    expect(sw.fetchImpl).not.toHaveBeenCalled();
  });

  it("shell stale-while-revalidate: responde con el shell en caché y, si la red trae uno distinto, avisa a la página", async () => {
    const caches = createCaches({ "renta-ia-build2": { "/index.html": new Response("<html>viejo</html>") } });
    const fetchImpl = vi.fn(async () => new Response("<html>nuevo</html>"));
    const sw = loadServiceWorker({ caches, fetchImpl });
    const event = fetchEvent("/", { mode: "navigate" });
    sw.handlers.fetch(event);

    const response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe("<html>viejo</html>"); // respuesta inmediata
    await event.settled();
    expect(sw.postMessage).toHaveBeenCalledWith({ type: "SHELL_UPDATED" });
    expect(await (await caches.api.match("/index.html")).text()).toBe("<html>nuevo</html>");
  });

  it("si el shell de la red es igual, no avisa", async () => {
    const caches = createCaches({ "renta-ia-build2": { "/index.html": new Response("<html>igual</html>") } });
    const sw = loadServiceWorker({ caches, fetchImpl: vi.fn(async () => new Response("<html>igual</html>")) });
    const event = fetchEvent("/clientes", { mode: "navigate" });
    sw.handlers.fetch(event);
    await event.respondWith.mock.calls[0][0];
    await event.settled();
    expect(sw.postMessage).not.toHaveBeenCalled();
  });

  it("assets con 'Vary: Origin' se encuentran igual (ignoreVary): si no, fallan offline", async () => {
    const cached = new Response("js", { headers: { Vary: "Origin" } });
    const caches = createCaches({ "renta-ia-build2": { "/assets/app-abc123.js": cached } });
    const sw = loadServiceWorker({ caches, fetchImpl: vi.fn(async () => Promise.reject(new TypeError("sin red"))) });
    const event = fetchEvent("/assets/app-abc123.js");
    sw.handlers.fetch(event);
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe("js");
  });

  it("sin red y sin shell en caché: página offline propia", async () => {
    const caches = createCaches({ "renta-ia-build2": { "/offline.html": new Response("offline") } });
    const sw = loadServiceWorker({ caches, fetchImpl: vi.fn(async () => Promise.reject(new TypeError("sin red"))) });
    const event = fetchEvent("/", { mode: "navigate" });
    sw.handlers.fetch(event);
    expect(await (await event.respondWith.mock.calls[0][0]).text()).toBe("offline");
  });
});

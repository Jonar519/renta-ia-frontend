import fs from "fs";
import vm from "vm";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Ejecuta public/service-worker.js en un contexto simulado para verificar
// qué peticiones intercepta (el navegador de pruebas no registra SW reales).
function loadServiceWorker() {
  const handlers = {};
  const deleted = [];
  const self = {
    location: { origin: "http://localhost:5173" },
    addEventListener: (type, fn) => (handlers[type] = fn),
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const caches = {
    keys: async () => ["renta-ia-cache-v1", "renta-ia-cache-v2"],
    delete: async (key) => deleted.push(key),
    match: vi.fn(async () => undefined),
    open: async () => ({ addAll: vi.fn(), put: vi.fn() }),
  };
  const code = fs.readFileSync("public/service-worker.js", "utf8");
  vm.runInNewContext(code, { self, caches, URL, Promise, fetch: vi.fn() });
  return { handlers, deleted };
}

function fetchEvent(url, method = "GET") {
  return { request: { url, method }, respondWith: vi.fn() };
}

describe("service-worker.js", () => {
  let sw;
  beforeEach(() => {
    sw = loadServiceWorker();
  });

  it("no intercepta (network-only, sin caché) las llamadas a la API en otro origen", () => {
    const event = fetchEvent("http://localhost:4000/api/clients/123/tax-concepts");
    sw.handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("no intercepta /api/ aunque la API esté en el mismo origen", () => {
    const event = fetchEvent("http://localhost:5173/api/documents/client/1");
    sw.handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("no intercepta métodos distintos de GET", () => {
    const event = fetchEvent("http://localhost:5173/index.html", "POST");
    sw.handlers.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("sirve los assets estáticos propios con cache-first", () => {
    const event = fetchEvent("http://localhost:5173/favicon.svg");
    sw.handlers.fetch(event);
    expect(event.respondWith).toHaveBeenCalledTimes(1);
  });

  it("al activarse borra la caché v1 (que contenía respuestas de la API)", async () => {
    let pending;
    sw.handlers.activate({ waitUntil: (p) => (pending = p) });
    await pending;
    expect(sw.deleted).toEqual(["renta-ia-cache-v1"]);
  });
});

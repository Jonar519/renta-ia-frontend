/* global __PRECACHE_URLS__ */
/**
 * Service Worker de Renta IA (política completa: docs/cache-policy.md).
 *
 * Este archivo NO se sirve tal cual: el plugin de vite.config.js lo emite
 * como /service-worker.js en cada build, reemplazando:
 *   __BUILD_ID__      id único del build → el archivo cambia en cada despliegue,
 *                     y así el navegador detecta que hay un SW nuevo
 *   __PRECACHE_URLS__ lista real de archivos del build (shell + assets con hash)
 *
 * Estrategias:
 *   - Navegaciones (el "shell" index.html): stale-while-revalidate. Se sirve
 *     el shell en caché al instante y se pide el de la red en paralelo; si
 *     cambió, se guarda y se avisa a la página ("hay una versión nueva").
 *     Sin red y sin caché: página offline propia.
 *   - /assets/* (nombre con hash, contenido inmutable): cache-first.
 *   - API y cualquier otro origen: NO se interceptan (network-only). Los
 *     datos tributarios nunca se guardan en Cache Storage.
 *   - Al activarse, se borran las cachés de builds anteriores.
 */

const BUILD_ID = "__BUILD_ID__";
const PRECACHE_URLS = __PRECACHE_URLS__;
const CACHE_PREFIX = "renta-ia-";
const CACHE_NAME = `${CACHE_PREFIX}${BUILD_ID}`;
const SHELL_URL = "/index.html";
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  // Sin skipWaiting(): la versión nueva ESPERA hasta que el usuario acepte
  // recargar (así no se mezcla el código viejo de la página con assets nuevos).
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key))
        )
      )
      // Limpia también las cachés de versiones anteriores del SW (renta-ia-cache-v1/v2).
      .then(() => caches.keys())
      .then((keys) =>
        Promise.all(keys.filter((key) => key.startsWith("renta-ia-cache-")).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

// La página pide activar la versión nueva cuando el usuario pulsa "Recargar".
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function notifyClients(message) {
  const clients = await self.clients.matchAll({ type: "window" });
  for (const client of clients) client.postMessage(message);
}

async function staleWhileRevalidateShell(event) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(SHELL_URL);

  const revalidate = fetch(SHELL_URL, { cache: "no-cache" })
    .then(async (response) => {
      if (!response.ok) return response;
      if (cached) {
        const [fresh, old] = await Promise.all([response.clone().text(), cached.clone().text()]);
        if (fresh !== old) {
          await cache.put(SHELL_URL, response.clone());
          await notifyClients({ type: "SHELL_UPDATED" });
        }
      } else {
        await cache.put(SHELL_URL, response.clone());
      }
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(revalidate);
    return cached;
  }
  return (await revalidate) || (await cache.match(OFFLINE_URL)) || Response.error();
}

async function cacheFirst(request) {
  const cache = await caches.open(CACHE_NAME);
  // ignoreVary: el servidor responde "Vary: Origin" y los módulos JS y las
  // fuentes se piden en modo CORS (con Origin), mientras que el precache los
  // guardó sin esa cabecera: sin ignoreVary, cache.match() no los encuentra
  // y offline fallan. Es seguro: /assets/* lleva hash y es inmutable.
  const cached = await cache.match(request, { ignoreVary: true });
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  // API y otros orígenes: network-only (sin respondWith, nada se cachea).
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(staleWhileRevalidateShell(event));
    return;
  }
  event.respondWith(cacheFirst(request));
});

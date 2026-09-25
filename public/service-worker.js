const CACHE_NAME = "renta-ia-cache-v1";
const STATIC_ASSETS = ["/", "/index.html", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Nunca interceptar nada que no sea GET (nunca cachear POST/PATCH/DELETE).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Llamadas a la API: network-first, con fallback a cache si no hay conexión
  // (permite seguir consultando datos ya vistos sin conexión estable).
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  // Assets estáticos de la app: cache-first.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

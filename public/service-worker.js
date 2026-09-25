// v2: la v1 guardaba respuestas de la API (datos tributarios) en la caché.
// Al activarse esta versión se borra cualquier caché anterior, incluida esa.
const CACHE_NAME = "renta-ia-cache-v2";
const STATIC_ASSETS = ["/", "/index.html", "/favicon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Nunca interceptar nada que no sea GET (nunca cachear POST/PATCH/DELETE).
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // API y cualquier otro origen (el backend corre en otro puerto/dominio):
  // network-only. Sin respondWith, el navegador hace la petición normal y
  // NADA se guarda en la caché. Las respuestas de la API contienen datos
  // tributarios sensibles que no deben quedar en el dispositivo (p. ej. tras
  // cerrar sesión en un equipo compartido).
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  // Assets estáticos propios de la app: cache-first.
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});

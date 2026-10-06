import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

import { recheckRoute, registerRoute, setNoticeRenderer, setRouteGuard, startRouter } from "./router.js";
import { decideRoute } from "./auth/routeAccess.js";
import { getState, hasSession, subscribe } from "./state/store.js";
import { restoreSession } from "./auth/session.js";

const app = document.getElementById("app");

/**
 * Code-splitting por vista: cada vista es un chunk aparte que se descarga
 * solo al entrar a su ruta (el login no carga el código del detalle de
 * cliente). La vista se llama sin await: pinta su estructura de forma
 * síncrona y sigue cargando datos en segundo plano, así que la promesa se
 * resuelve apenas la vista es visible.
 */
function lazyView(load) {
  return async (params, { isStale }) => {
    const module = await load();
    if (isStale()) return; // el usuario ya navegó a otra ruta mientras se descargaba
    module.default(app, params);
  };
}

// Rutas: [patrón, vista (import diferido; exporta por defecto (root, params)),
// acceso]. auth/routeAccess.js decide con el acceso: auth = requiere sesión;
// roles = solo esos roles; label = nombre para el aviso de rebote.
// Las pantallas que llegan desde un enlace de correo (invitación,
// restablecer) quitan el token de la barra y quedan en la ruta sin él.
const PUBLIC = { auth: false };
const ADMIN = ["admin"];
const ROUTES = [
  ["/login", () => import("./views/login.view.js"), PUBLIC],
  ["/recuperar", () => import("./views/forgotPassword.view.js"), PUBLIC],
  ["/restablecer/:token", () => import("./views/resetPassword.view.js"), PUBLIC],
  ["/restablecer", () => import("./views/resetPassword.view.js"), PUBLIC],
  ["/invitacion/:token", () => import("./views/completeAccount.view.js"), PUBLIC],
  ["/invitacion", () => import("./views/completeAccount.view.js"), PUBLIC],
  ["/", () => import("./views/dashboard.view.js"), { auth: true, label: "Clientes" }],
  ["/clients/:id", () => import("./views/clientDetail/index.js"), { auth: true, label: "Detalle de cliente" }],
  ["/profile", () => import("./views/profile.view.js"), { auth: true, label: "Mi perfil" }],
  ["/seguridad", () => import("./views/security.view.js"), { auth: true, label: "Seguridad", mfaSetup: true }],
  ["/performance", () => import("./views/performance.view.js"), { auth: true, roles: ADMIN, label: "Rendimiento" }],
  ["/admin/users", () => import("./views/adminUsers.view.js"), { auth: true, roles: ADMIN, label: "Usuarios" }],
];
for (const [pattern, load, access] of ROUTES) registerRoute(pattern, lazyView(load), access);

// Guard: sin sesión → login; rol sin permiso o ruta inexistente → Clientes,
// con un aviso que explica por qué. El rol se vuelve a comprobar cuando
// cambia la sesión (la pista de localStorage puede traer un rol desactualizado).
// MFA obligatorio (admin, decidido por la API): mientras no lo active, solo "Seguridad".
setRouteGuard((route) => {
  const { user } = getState();
  return decideRoute(route, {
    hasSession: hasSession(),
    role: user?.role,
    mfaPending: user?.role === "admin" && user.mfaEnabled === false,
  });
});
// El aviso es raro (solo tras un rebote): su código se descarga cuando hace falta.
setNoticeRenderer((message) => import("./components/routeNotice.js").then((m) => m.showRouteNotice(message)));
// Solo con usuario: el cierre de sesión ya lleva al login (auth/session.js).
subscribe((state) => state.user && recheckRoute());

// Skip-link: con un router basado en hash, un href="#main-content" normal
// cambiaría de ruta. Se intercepta y se mueve el foco al contenido principal.
document.querySelector(".skip-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  document.getElementById("main-content")?.focus();
});

// Notificaciones en tiempo real mientras haya sesión. El módulo (WebSocket +
// reconexión) se descarga recién con la primera sesión: el login no lo usa y
// el chunk de entrada tiene presupuesto de 4 KB. Las llamadas se encadenan
// sobre la misma promesa, así que respetan el orden (iniciar → detener).
let realtime = null;
function syncRealtime(state) {
  if (state.token) {
    realtime ??= import("./realtime/realtime.js");
    realtime.then((m) => m.startRealtime(() => getState().token));
  } else {
    realtime?.then((m) => m.stopRealtime());
  }
}
subscribe(syncRealtime);
syncRealtime(getState());

// Caché offline (IndexedDB): al cerrar sesión se borra toda; al entrar, se
// borran las de cualquier OTRO usuario que haya usado este navegador.
// Import dinámico: no hace falta para la primera pintura (presupuesto del
// chunk de entrada) y el Service Worker lo precachea, así que funciona offline.
function syncOfflineData(state) {
  import("./offline/offlineStore.js").then((m) => m.clearOfflineData({ keepUserId: state.user?.id })).catch(() => {});
}
subscribe(syncOfflineData);
syncOfflineData(getState());

import("./components/connectivityBanner.js").then((m) => m.startConnectivityBanner());

// Recupera la sesión con la cookie de refresh (en paralelo con la primera vista).
restoreSession();
startRouter();
// Métricas de usuarios reales (Web Vitals + tareas largas), anónimas.
// Se cargan DESPUÉS del evento load y en tiempo ocioso para no competir con
// la carga inicial (web-vitals pesa ~6 KB): sus PerformanceObserver usan
// buffered: true, así que igual reciben LCP, FCP y TTFB ya ocurridos.
// El Service Worker también se registra tras el load (nunca hizo falta para
// la primera pintura): su código se descarga recién entonces y no pesa en el
// chunk de entrada (presupuesto de 4 KB).
window.addEventListener("load", () => {
  import("./sw/registerSW.js").then((m) => m.registerServiceWorker());
  const start = () => import("./metrics/webVitals.js").then((m) => m.startWebVitals());
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 0);
});

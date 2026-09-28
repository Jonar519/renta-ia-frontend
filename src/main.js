import "./styles/fonts.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

import { registerRoute, startRouter } from "./router.js";
import { getState, subscribe } from "./state/store.js";
import { startRealtime, stopRealtime } from "./realtime/realtime.js";
import { registerServiceWorker } from "./sw/registerSW.js";

const app = document.getElementById("app");

/**
 * Code-splitting por vista: cada vista es un chunk aparte que se descarga
 * solo al entrar a su ruta (el login no carga el código del detalle de
 * cliente). La función de render de la vista se llama sin await: pinta su
 * estructura de forma síncrona y sigue cargando datos en segundo plano, así
 * que la promesa se resuelve apenas la vista es visible.
 */
function lazyView(load, render, { auth = true } = {}) {
  return async (params, { isStale }) => {
    if (auth && !getState().token) {
      window.location.hash = "/login";
      return;
    }
    const module = await load();
    if (isStale()) return; // el usuario ya navegó a otra ruta mientras se descargaba
    render(module, params);
  };
}

registerRoute(
  "/login",
  lazyView(
    () => import("./views/login.view.js"),
    (m) => m.renderLogin(app),
    { auth: false }
  )
);
registerRoute(
  "/",
  lazyView(
    () => import("./views/dashboard.view.js"),
    (m) => m.renderDashboard(app)
  )
);
registerRoute(
  "/clients/:id",
  lazyView(
    () => import("./views/clientDetail/index.js"),
    (m, params) => m.renderClientDetail(app, params.id)
  )
);
registerRoute(
  "/performance",
  lazyView(
    () => import("./views/performance.view.js"),
    (m) => (getState().user?.role === "admin" ? m.renderPerformance(app) : (window.location.hash = "/"))
  )
);

// Skip-link: con un router basado en hash, un href="#main-content" normal
// cambiaría de ruta. Se intercepta y se mueve el foco al contenido principal.
document.querySelector(".skip-link")?.addEventListener("click", (event) => {
  event.preventDefault();
  document.getElementById("main-content")?.focus();
});

// Notificaciones en tiempo real mientras haya sesión.
function syncRealtime(state) {
  if (state.token) startRealtime(() => getState().token);
  else stopRealtime();
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

startRouter();
// Métricas de usuarios reales (Web Vitals + tareas largas), anónimas.
// Se cargan DESPUÉS del evento load y en tiempo ocioso para no competir con
// la carga inicial (web-vitals pesa ~6 KB): sus PerformanceObserver usan
// buffered: true, así que igual reciben LCP, FCP y TTFB ya ocurridos.
window.addEventListener("load", () => {
  const start = () => import("./metrics/webVitals.js").then((m) => m.startWebVitals());
  if ("requestIdleCallback" in window) requestIdleCallback(start, { timeout: 3000 });
  else setTimeout(start, 0);
});
registerServiceWorker();

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

import { registerRoute, startRouter } from "./router.js";
import { getState, subscribe } from "./state/store.js";
import { startRealtime, stopRealtime } from "./realtime/realtime.js";
import { renderLogin } from "./views/login.view.js";
import { renderDashboard } from "./views/dashboard.view.js";
import { renderClientDetail } from "./views/clientDetail/index.js";
import { registerServiceWorker } from "./sw/registerSW.js";

const app = document.getElementById("app");

function requireAuth(handler) {
  return (params) => {
    if (!getState().token) {
      window.location.hash = "/login";
      return;
    }
    handler(params);
  };
}

registerRoute("/login", () => renderLogin(app));
registerRoute(
  "/",
  requireAuth(() => renderDashboard(app))
);
registerRoute(
  "/clients/:id",
  requireAuth((params) => renderClientDetail(app, params.id))
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

startRouter();
registerServiceWorker();

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/components.css";

import { registerRoute, startRouter } from "./router.js";
import { getState } from "./state/store.js";
import { renderLogin } from "./views/login.view.js";
import { renderDashboard } from "./views/dashboard.view.js";
import { renderClientDetail } from "./views/clientDetail.view.js";
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
registerRoute("/", requireAuth(() => renderDashboard(app)));
registerRoute("/clients/:id", requireAuth((params) => renderClientDetail(app, params.id)));

startRouter();
registerServiceWorker();

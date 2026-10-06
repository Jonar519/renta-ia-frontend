import { getState } from "../state/store.js";
import { registerCleanup } from "../router.js";
import { bindUserMenu, userMenuHtml } from "./userMenu.js";

export function renderSidebar(active) {
  const link = (id, href, label) =>
    `<a class="sidebar__link ${active === id ? "is-active" : ""}" href="${href}"${active === id ? ' aria-current="page"' : ""}>${label}</a>`;
  const isAdmin = getState().user?.role === "admin";
  return `
    <aside class="sidebar">
      <div class="sidebar__brand">Renta IA</div>
      <nav class="sidebar__nav" aria-label="Principal">
        ${link("dashboard", "#/", "Clientes")}
        ${isAdmin ? link("performance", "#/performance", "Rendimiento") : ""}
      </nav>
      ${userMenuHtml()}
    </aside>
  `;
}

export function bindSidebarEvents(root) {
  registerCleanup(bindUserMenu(root));
}

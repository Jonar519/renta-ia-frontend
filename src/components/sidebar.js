import { clearAuth } from "../state/store.js";

export function renderSidebar(active) {
  return `
    <aside class="sidebar">
      <div class="sidebar__brand">Renta IA</div>
      <nav class="sidebar__nav">
        <a class="sidebar__link ${active === "dashboard" ? "is-active" : ""}" href="#/">Clientes</a>
      </nav>
      <button id="btn-logout" class="sidebar__logout" type="button">Cerrar sesión</button>
    </aside>
  `;
}

export function bindSidebarEvents(root) {
  const logoutBtn = root.querySelector("#btn-logout");
  if (!logoutBtn) return;

  logoutBtn.addEventListener("click", () => {
    clearAuth();
    window.location.hash = "/login";
  });
}

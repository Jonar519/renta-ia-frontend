import { usersApi } from "../api/users.api.js";
import { ROLE_LABELS } from "../auth/roles.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { bindRetry, errorStateHtml, skeletonBlockHtml } from "../components/states.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/** "Mi perfil": datos de la cuenta (la edición llega con el bloque de perfil). */
export async function renderProfile(root) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("profile")}
      <main class="main" id="main-content" tabindex="-1">
        <header class="main__header">
          <div>
            <h1 class="page-title">Mi perfil</h1>
            <p class="page-subtitle">Los datos de tu cuenta en Renta IA.</p>
          </div>
        </header>
        <section class="panel" aria-labelledby="profile-data-title">
          <h2 id="profile-data-title">Datos de la cuenta</h2>
          <div id="profile-data" aria-live="polite">${skeletonBlockHtml({ lines: 3, label: "Cargando tus datos…" })}</div>
        </section>
      </main>
    </div>
  `;
  bindSidebarEvents(root);

  const container = root.querySelector("#profile-data");
  async function load() {
    container.setAttribute("aria-busy", "true");
    try {
      const me = await usersApi.me();
      container.innerHTML = `
        <dl class="profile-data">
          <dt>Nombre</dt><dd>${escapeHtml(me.name)}</dd>
          <dt>Correo</dt><dd>${escapeHtml(me.email)}</dd>
          <dt>Rol</dt><dd>${escapeHtml(ROLE_LABELS[me.role] ?? me.role)}</dd>
        </dl>`;
    } catch (err) {
      if (err.name === "AbortError") return;
      container.innerHTML = errorStateHtml(err.message, { title: "No se pudieron cargar tus datos." });
    } finally {
      container.removeAttribute("aria-busy");
    }
  }
  bindRetry(container, load);
  await load();
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderProfile(root);

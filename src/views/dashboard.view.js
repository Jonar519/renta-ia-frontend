import { clientsApi } from "../api/clients.api.js";
import { showToast } from "../components/toast.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { escapeHtml } from "../utils/escapeHtml.js";

export async function renderDashboard(root) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("dashboard")}
      <main class="main" id="main-content" tabindex="-1">
        <header class="main__header">
          <div>
            <h1 class="page-title">Tus clientes</h1>
            <p class="page-subtitle">Administra la información tributaria de cada cliente contribuyente.</p>
          </div>
          <button id="btn-new-client" class="btn btn--primary" type="button" aria-expanded="false" aria-controls="new-client-panel">Nuevo cliente</button>
        </header>

        <section class="panel" id="new-client-panel" aria-labelledby="new-client-title" hidden>
          <h2 id="new-client-title">Nuevo cliente contribuyente</h2>
          <form id="new-client-form" class="form-grid">
            <label>Nombre completo
              <input type="text" name="fullName" required minlength="2" maxlength="200" />
            </label>
            <label>Cédula o NIT
              <input type="text" name="documentNumber" required minlength="3" maxlength="30" pattern="[0-9A-Za-z.\\-]+" title="Solo números, letras, puntos y guiones" />
            </label>
            <label>Correo (opcional)
              <input type="email" name="email" maxlength="150" />
            </label>
            <label>Teléfono (opcional)
              <input type="tel" name="phone" maxlength="30" />
            </label>
            <div class="form-actions">
              <button type="button" id="btn-cancel-client" class="btn btn--ghost">Cancelar</button>
              <button type="submit" class="btn btn--primary">Guardar cliente</button>
            </div>
          </form>
        </section>

        <section class="panel">
          <table class="table">
            <caption class="visually-hidden">Tus clientes contribuyentes</caption>
            <thead>
              <tr>
                <th scope="col">Cliente</th>
                <th scope="col">Documento</th>
                <th scope="col">Correo</th>
                <th scope="col">Creado</th>
                <th scope="col"><span class="visually-hidden">Acciones</span></th>
              </tr>
            </thead>
            <tbody id="clients-tbody">
              <tr><td colspan="5" class="table__empty">Cargando...</td></tr>
            </tbody>
          </table>
        </section>
      </main>
    </div>
  `;

  bindSidebarEvents(root);

  const panel = root.querySelector("#new-client-panel");
  const form = root.querySelector("#new-client-form");
  const newClientBtn = root.querySelector("#btn-new-client");

  function openPanel() {
    panel.hidden = false;
    newClientBtn.setAttribute("aria-expanded", "true");
    form.elements.fullName.focus();
  }

  // Al cerrar, el foco vuelve al botón que abrió el panel.
  function closePanel() {
    panel.hidden = true;
    newClientBtn.setAttribute("aria-expanded", "false");
    form.reset();
    newClientBtn.focus();
  }

  newClientBtn.addEventListener("click", openPanel);
  root.querySelector("#btn-cancel-client").addEventListener("click", closePanel);
  panel.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closePanel();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());

    try {
      await clientsApi.create(data);
      showToast("Cliente creado correctamente", "success");
      closePanel();
      await loadClients();
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  async function loadClients() {
    const tbody = root.querySelector("#clients-tbody");
    try {
      const clients = await clientsApi.list();

      if (clients.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="table__empty">Todavía no tienes clientes. Crea el primero con "Nuevo cliente".</td></tr>`;
        return;
      }

      tbody.innerHTML = clients
        .map(
          (c) => `
        <tr>
          <td class="table__primary">${escapeHtml(c.fullName)}</td>
          <td>${escapeHtml(c.documentNumber)}</td>
          <td>${escapeHtml(c.email || "—")}</td>
          <td>${new Date(c.createdAt).toLocaleDateString("es-CO")}</td>
          <td><a class="link" href="#/clients/${c.id}">Ver detalle</a></td>
        </tr>`
        )
        .join("");
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  await loadClients();
}

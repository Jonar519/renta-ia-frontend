import { adminApi } from "../api/admin.api.js";
import { mountReassign } from "./adminReassign.js";
import { ROLE_LABELS } from "../auth/roles.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { bindDensityToggles, densityToggleHtml } from "../components/densityToggle.js";
import { showErrorToast, showToast } from "../components/toast.js";
import {
  bindRetry,
  emptyStateHtml,
  errorStateHtml,
  inRow,
  setPending,
  skeletonRowsHtml,
} from "../components/states.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * Usuarios (solo admin; el guard de rutas y la API lo imponen). Las cuentas
 * se crean SOLO por invitación: el admin indica nombre, correo y rol, y el
 * enlace para activar la cuenta llega solo al correo de la persona. Esta
 * pantalla nunca recibe ni muestra el token ni el enlace.
 */

const COLUMNS = 5;
const loadingHtml = skeletonRowsHtml(COLUMNS, { rows: 3, label: "Cargando invitaciones…" });

const STATUS = {
  pending: { text: "Pendiente", tone: "info" },
  expired: { text: "Vencida", tone: "warning" },
};

const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });
/** "en 3 días", "hace 5 horas"… (para el vencimiento). */
export function untilText(date, now = Date.now()) {
  const hours = Math.round((new Date(date).getTime() - now) / 3_600_000);
  return Math.abs(hours) < 48 ? relative.format(hours, "hour") : relative.format(Math.round(hours / 24), "day");
}

export function invitationRowHtml(inv) {
  const status = STATUS[inv.status] ?? { text: inv.status, tone: "neutral" };
  const link = inv.accountant
    ? `<p class="table__note">Asiste a ${escapeHtml(inv.accountant.name)}</p>`
    : inv.client
      ? `<p class="table__note">Expediente de ${escapeHtml(inv.client.fullName)}</p>`
      : "";
  const expires = inv.expiresAt
    ? `<time class="num" datetime="${escapeHtml(inv.expiresAt)}">${escapeHtml(new Date(inv.expiresAt).toLocaleString("es-CO"))}</time>
       <p class="table__note">${inv.status === "expired" ? "Venció" : "Vence"} ${escapeHtml(untilText(inv.expiresAt))}</p>`
    : "—";
  const who = escapeHtml(inv.name);
  return `
    <tr data-user-id="${escapeHtml(inv.userId)}">
      <td data-label="Persona"><span class="table__primary">${who}</span><p class="table__note">${escapeHtml(inv.email)}</p></td>
      <td data-label="Rol">${escapeHtml(ROLE_LABELS[inv.role] ?? inv.role)}${link}</td>
      <td data-label="Estado"><span class="badge badge--${status.tone}">${status.text}</span></td>
      <td data-label="Vencimiento">${expires}</td>
      <td class="table__actions">
        <button type="button" class="btn btn--ghost btn--small" data-requires-network data-action="resend">Reenviar<span class="visually-hidden"> la invitación de ${who}</span></button>
        <button type="button" class="btn btn--ghost btn--small btn--danger" data-requires-network data-action="cancel">Cancelar<span class="visually-hidden"> la invitación de ${who}</span></button>
      </td>
    </tr>`;
}

export async function renderAdminUsers(root) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("users")}
      <main class="main" id="main-content" tabindex="-1">
        <header class="main__header">
          <div>
            <h1 class="page-title">Usuarios</h1>
            <p class="page-subtitle">Las cuentas se crean solo por invitación. El enlace para activarla llega únicamente al correo de la persona: aquí no se muestra.</p>
          </div>
        </header>

        <section class="panel" aria-labelledby="invite-title">
          <h2 id="invite-title">Invitar a una persona</h2>
          <form id="invite-form" class="form-grid" data-requires-network>
            <label>Nombre completo
              <input type="text" name="name" required minlength="2" maxlength="150" autocomplete="off" />
            </label>
            <label>Correo
              <input type="email" name="email" required maxlength="150" autocomplete="off" />
            </label>
            <label>Rol
              <select name="role" required>
                <option value="accountant">${ROLE_LABELS.accountant}</option>
                <option value="assistant">${ROLE_LABELS.assistant}</option>
                <option value="client">${ROLE_LABELS.client} (portal)</option>
                <option value="admin">${ROLE_LABELS.admin}</option>
              </select>
            </label>
            <div id="role-extra" class="form-grid__wide"></div>
            <p class="form-hint form-grid__wide" id="invite-note">La persona tendrá 72 horas para activar su cuenta con su propia contraseña.</p>
            <div class="form-actions">
              <button type="submit" class="btn btn--primary">Enviar invitación</button>
            </div>
          </form>
        </section>

        <section class="panel" aria-labelledby="pending-title">
          <h2 id="pending-title" tabindex="-1">Invitaciones pendientes</h2>
          <div class="table-toolbar">${densityToggleHtml()}</div>
          <table class="table table--stack" id="invitations-table">
            <caption class="visually-hidden">Cuentas invitadas que todavía no se activaron, con su estado y vencimiento</caption>
            <thead><tr>
              <th scope="col">Persona</th><th scope="col">Rol</th><th scope="col">Estado</th><th scope="col">Vencimiento</th>
              <th scope="col"><span class="visually-hidden">Acciones</span></th>
            </tr></thead>
            <tbody id="invitations-tbody">${loadingHtml}</tbody>
          </table>
        </section>

        <dialog id="cancel-dialog" class="dialog" aria-labelledby="cancel-title" aria-describedby="cancel-text">
          <h2 id="cancel-title">¿Cancelar la invitación?</h2>
          <p id="cancel-text"></p>
          <div class="form-actions">
            <button type="button" class="btn btn--ghost" data-dialog="back" autofocus>Volver</button>
            <button type="button" class="btn btn--primary btn--danger-fill" data-dialog="confirm">Cancelar invitación</button>
          </div>
        </dialog>
        <div id="reassign-slot"></div>
      </main>
    </div>`;
  bindSidebarEvents(root);
  bindDensityToggles(root);

  const form = root.querySelector("#invite-form");
  const roleExtra = root.querySelector("#role-extra");
  const tbody = root.querySelector("#invitations-tbody");
  const table = root.querySelector("#invitations-table");
  const dialog = root.querySelector("#cancel-dialog");
  let invitations = [];
  const rowOf = (userId) => [...tbody.querySelectorAll("tr[data-user-id]")].find((r) => r.dataset.userId === userId);

  // --- Lista ---
  async function loadList() {
    if (invitations.length === 0) tbody.innerHTML = loadingHtml;
    table.setAttribute("aria-busy", "true");
    try {
      ({ items: invitations } = await adminApi.listInvitations());
      tbody.innerHTML = invitations.length
        ? invitations.map(invitationRowHtml).join("")
        : inRow(
            COLUMNS,
            emptyStateHtml(
              "No hay invitaciones pendientes.",
              "Cuando invites a alguien aparecerá aquí hasta que active su cuenta. Las cuentas activas no se listan."
            )
          );
    } catch (err) {
      if (err.name === "AbortError") return;
      invitations = [];
      tbody.innerHTML = inRow(
        COLUMNS,
        errorStateHtml(err.message, { title: "No se pudieron cargar las invitaciones." })
      );
    } finally {
      table.removeAttribute("aria-busy");
    }
  }
  bindRetry(tbody, loadList);

  // --- Campos según el rol ---
  async function renderRoleExtra() {
    const role = form.elements.role.value;
    if (role === "assistant") {
      roleExtra.innerHTML = `<label>Contador al que asistirá
          <select name="accountantUserId" required><option value="">Cargando contadores…</option></select>
        </label>`;
      const select = roleExtra.querySelector("select");
      try {
        const { items } = await adminApi.accountants();
        select.innerHTML =
          `<option value="">Elige un contador</option>` +
          items
            .map((a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(a.name)} · ${escapeHtml(a.email)}</option>`)
            .join("");
      } catch (err) {
        select.innerHTML = `<option value="">No se pudo cargar la lista</option>`;
        showErrorToast(err);
      }
    } else if (role === "client") {
      roleExtra.innerHTML = `
        <div class="portal-search">
          <label>Buscar expediente (nombre o documento)
            <input type="search" name="clientQuery" maxlength="100" autocomplete="off" />
          </label>
          <button type="button" class="btn btn--ghost" data-action="search-clients">Buscar</button>
        </div>
        <label>Expediente que podrá consultar
          <select name="clientId" required><option value="">Busca un expediente</option></select>
        </label>
        <p class="form-hint">Solo aparecen expedientes que todavía no tienen usuario de portal (máximo 20 resultados).</p>`;
      await searchClients();
    } else {
      roleExtra.innerHTML = "";
    }
  }

  async function searchClients() {
    const select = roleExtra.querySelector("select[name=clientId]");
    if (!select) return;
    select.innerHTML = `<option value="">Buscando…</option>`;
    try {
      const { items } = await adminApi.portalClients(form.elements.clientQuery?.value.trim());
      select.innerHTML = items.length
        ? `<option value="">Elige un expediente</option>` +
          items
            .map(
              (c) =>
                `<option value="${escapeHtml(c.id)}">${escapeHtml(c.fullName)} · ${escapeHtml(c.documentNumber)} · ${escapeHtml(c.accountant.name)}</option>`
            )
            .join("")
        : `<option value="">Sin resultados</option>`;
    } catch (err) {
      select.innerHTML = `<option value="">No se pudo buscar</option>`;
      showErrorToast(err);
    }
  }

  form.elements.role.addEventListener("change", renderRoleExtra);
  roleExtra.addEventListener("click", (event) => {
    if (event.target.closest("[data-action=search-clients]")) searchClients();
  });
  roleExtra.addEventListener("keydown", (event) => {
    // Enter en el buscador busca, no envía la invitación.
    if (event.key === "Enter" && event.target.name === "clientQuery") {
      event.preventDefault();
      searchClients();
    }
  });

  // --- Invitar ---
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    delete data.clientQuery;
    for (const key of Object.keys(data)) if (data[key] === "") delete data[key];
    const done = setPending(form.querySelector("button[type=submit]"), "Enviando…");
    try {
      await adminApi.invite(data);
      showToast(`Invitación enviada a ${data.email}. El enlace llega solo a ese correo.`, "success");
      form.reset();
      roleExtra.innerHTML = "";
      form.elements.name.focus();
    } catch (err) {
      // 502: la invitación quedó creada pero el correo falló (se puede reenviar).
      showErrorToast(err);
      if (err.status !== 502) return;
    } finally {
      done();
    }
    await loadList();
  });

  // --- Reenviar / cancelar ---
  let pendingCancel = null;
  tbody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-action]");
    if (!button) return;
    const row = button.closest("tr[data-user-id]");
    const invitation = invitations.find((i) => i.userId === row?.dataset.userId);
    if (!invitation) return;

    if (button.dataset.action === "resend") {
      const done = setPending(button, "Reenviando…");
      try {
        const updated = await adminApi.resendInvitation(invitation.userId);
        invitations = invitations.map((i) => (i.userId === updated.userId ? updated : i));
        row.outerHTML = invitationRowHtml(updated);
        showToast(`Se envió un enlace nuevo a ${invitation.email}. El anterior ya no sirve.`, "success");
        rowOf(updated.userId)?.querySelector("[data-action=resend]")?.focus();
      } catch (err) {
        done();
        showErrorToast(err);
      }
      return;
    }

    pendingCancel = { invitation, button };
    dialog.querySelector("#cancel-text").textContent =
      `Se eliminará la cuenta pendiente de ${invitation.name} (${invitation.email}) y su enlace dejará de funcionar. Podrás invitarla de nuevo.`;
    dialog.showModal();
  });

  dialog.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-dialog]")?.dataset.dialog;
    if (action === "back") dialog.close();
    if (action !== "confirm" || !pendingCancel) return;
    // Se toma la referencia ANTES de cerrar: el evento "close" la limpia.
    const { invitation } = pendingCancel;
    const confirmButton = event.target.closest("[data-dialog]");
    const done = setPending(confirmButton, "Cancelando…");
    try {
      await adminApi.cancelInvitation(invitation.userId);
      pendingCancel = null; // confirmada: al cerrar no se devuelve el foco a una fila que ya no existe
      dialog.close();
      showToast(`Invitación de ${invitation.email} cancelada.`, "success");
      invitations = invitations.filter((i) => i.userId !== invitation.userId);
      await loadList();
      root.querySelector("#pending-title")?.focus();
    } catch (err) {
      showErrorToast(err);
    } finally {
      done();
    }
  });
  dialog.addEventListener("close", () => {
    // Cerrado sin confirmar (Volver o Escape): el foco vuelve al botón que lo abrió.
    if (pendingCancel) pendingCancel.button.focus();
    pendingCancel = null;
  });

  mountReassign(root.querySelector("#reassign-slot"));
  await loadList();
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderAdminUsers(root);

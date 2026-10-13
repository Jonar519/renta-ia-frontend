import { adminApi } from "../api/admin.api.js";
import { bindRetry, errorStateHtml, setPending } from "../components/states.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Reasignar clientes" en Usuarios (solo admin, tras B15): pasa TODOS los
 * clientes de un contador a otro, con sus documentos, alertas y
 * conversaciones. Así un contador puede eliminar su cuenta sin borrar el
 * trabajo (renta-ia-backend/docs/data-retention.md). Pide confirmación.
 */
const plural = (n) => (n === 1 ? "1 cliente" : `${n} clientes`);
// Con el correo: dos contadores pueden llamarse igual.
const who = (a) => `${a.name} · ${a.email}`;
const option = (a) => `<option value="${escapeHtml(a.id)}">${escapeHtml(who(a))} (${plural(a.clientCount)})</option>`;

/** Monta la sección en `slot` (un hueco al final de Usuarios). */
export async function mountReassign(slot) {
  slot.innerHTML = `
    <section class="panel" aria-labelledby="reassign-title">
      <h2 id="reassign-title" tabindex="-1">Reasignar clientes</h2>
      <p>Pasa todos los clientes de un contador a otro: sus documentos, alertas y conversaciones van con ellos, y los asistentes del contador anterior dejan de verlos. Así un contador puede eliminar su cuenta.</p>
      <div id="reassign-body" aria-live="polite"></div>
    </section>`;
  const body = slot.querySelector("#reassign-body");
  const title = slot.querySelector("#reassign-title");

  async function load() {
    body.textContent = "Cargando contadores…";
    let accountants;
    try {
      ({ items: accountants } = await adminApi.accountants());
    } catch (err) {
      body.innerHTML = errorStateHtml(err.message);
      return;
    }
    const withClients = accountants.filter((a) => a.clientCount > 0);
    if (withClients.length === 0 || accountants.length < 2) {
      body.innerHTML = `<p class="form-hint">${
        withClients.length === 0
          ? "Ningún contador tiene clientes para reasignar."
          : "Hace falta otro contador con la cuenta activa para recibirlos."
      }</p>`;
      return;
    }
    body.innerHTML = `
      <form id="reassign-form" class="form-grid" data-requires-network novalidate>
        <label>Contador de origen
          <select name="from" required><option value="">Elige un contador</option>${withClients.map(option).join("")}</select>
        </label>
        <label>Contador de destino
          <select name="to" required><option value="">Elige un contador</option>${accountants.map(option).join("")}</select>
        </label>
        <p class="form-hint form-hint--error form-grid__wide" id="reassign-error" role="alert"></p>
        <div class="form-actions"><button type="submit" class="btn btn--primary">Reasignar</button></div>
      </form>
      <dialog id="reassign-dialog" class="dialog" aria-labelledby="reassign-dialog-title" aria-describedby="reassign-text">
        <h2 id="reassign-dialog-title">¿Reasignar los clientes?</h2>
        <p id="reassign-text"></p>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-dialog="back" autofocus>Volver</button>
          <button type="button" class="btn btn--primary" data-dialog="confirm">Reasignar</button>
        </div>
      </dialog>`;
    bind(accountants);
  }

  function bind(accountants) {
    const form = body.querySelector("#reassign-form");
    const dialog = body.querySelector("#reassign-dialog");
    const error = body.querySelector("#reassign-error");
    const submit = form.querySelector("button[type=submit]");
    const byId = (id) => accountants.find((a) => a.id === id);

    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const data = new FormData(form);
      error.textContent = "";
      if (!data.get("from") || !data.get("to")) {
        error.textContent = "Elige los dos contadores.";
        return;
      }
      if (data.get("from") === data.get("to")) {
        error.textContent = "Elige dos contadores distintos.";
        return;
      }
      const from = byId(data.get("from"));
      const to = who(byId(data.get("to")));
      dialog.querySelector("#reassign-text").textContent =
        from.clientCount === 1
          ? `El cliente de ${who(from)} pasará a ${to}. Sus asistentes dejarán de verlo.`
          : `Los ${from.clientCount} clientes de ${who(from)} pasarán a ${to}. Sus asistentes dejarán de verlos.`;
      dialog.showModal();
    });

    let moved = false;
    dialog.addEventListener("click", async (event) => {
      const action = event.target.closest("[data-dialog]")?.dataset.dialog;
      if (action === "back") dialog.close();
      if (action !== "confirm") return;
      const data = new FormData(form);
      const done = setPending(event.target.closest("[data-dialog]"), "Reasignando…");
      try {
        const result = await adminApi.reassignClients(data.get("from"), data.get("to"));
        moved = true;
        dialog.close();
        showToast(`Reasignaste ${plural(result.moved)}.`, "success");
        await load();
        title.focus(); // el formulario se volvió a pintar
      } catch (err) {
        done();
        dialog.close();
        error.textContent = err.message;
        showErrorToast(err);
      }
    });
    dialog.addEventListener("close", () => {
      // Volver o Escape (o un error): el foco vuelve al botón que la abrió.
      if (!moved) submit.focus();
    });
  }

  bindRetry(body, load);
  await load();
}

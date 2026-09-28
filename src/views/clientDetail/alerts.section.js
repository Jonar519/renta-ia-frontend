import { alertsApi } from "../../api/alerts.api.js";
import { showToast } from "../../components/toast.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { createPagedList } from "../../components/pagedList.js";
import { ALERT_STATUS, ALERT_TYPE_LABELS, SEVERITY_LABELS, SEVERITY_TONES } from "./labels.js";

export function alertsPanelHtml() {
  return `
    <section class="panel">
      <h2>Alertas</h2>
      <p id="alerts-status" class="visually-hidden" role="status" aria-live="polite"></p>
      <ul class="alert-list" id="alerts-list">
        <li class="table__empty">Cargando...</li>
      </ul>
      <div class="load-more">
        <button type="button" class="btn btn--ghost" id="alerts-more" aria-controls="alerts-list" hidden>Cargar más alertas</button>
      </div>
    </section>
  `;
}

function alertItemHtml(a) {
  const status = ALERT_STATUS[a.status] || { text: a.status, tone: "neutral" };
  const type = ALERT_TYPE_LABELS[a.alertType] || a.alertType;
  const actions = [];
  if (a.status === "open") {
    actions.push(
      `<button type="button" class="btn btn--ghost btn--small" data-alert-id="${escapeHtml(a.id)}" data-alert-status="acknowledged">Marcar como vista</button>`
    );
  }
  if (a.status !== "resolved") {
    actions.push(
      `<button type="button" class="btn btn--ghost btn--small" data-alert-id="${escapeHtml(a.id)}" data-alert-status="resolved">Resolver</button>`
    );
  }
  return `
    <li class="alert-item${a.status === "resolved" ? " alert-item--resolved" : ""}" data-alert-item="${escapeHtml(a.id)}" tabindex="-1">
      <span class="badge badge--${SEVERITY_TONES[a.severity] || "neutral"}">${SEVERITY_LABELS[a.severity] || escapeHtml(a.severity)}</span>
      <div class="alert-item__body">
        <p><strong>${escapeHtml(type)}</strong> · <span class="badge badge--${status.tone}">${escapeHtml(status.text)}</span></p>
        <p>${escapeHtml(a.message)}</p>
        <p class="alert-item__meta">${new Date(a.createdAt).toLocaleString("es-CO")}${
          a.dueDate ? " · vence " + new Date(a.dueDate).toLocaleDateString("es-CO", { timeZone: "UTC" }) : ""
        }</p>
        ${actions.length ? `<div class="alert-item__actions">${actions.join("")}</div>` : ""}
      </div>
    </li>`;
}

export function createAlertsSection(root, clientId) {
  const list = root.querySelector("#alerts-list");
  const liveStatus = root.querySelector("#alerts-status");

  // Paginado por cursor (50 por página) y render por lotes que ceden el hilo.
  const alerts = createPagedList({
    container: list,
    moreButton: root.querySelector("#alerts-more"),
    status: liveStatus,
    fetchPage: (cursor) => alertsApi.listByClient(clientId, { cursor }),
    renderItem: alertItemHtml,
    emptyHtml: `<li class="table__empty">No hay alertas para este cliente.</li>`,
    errorHtml: (message) => `<li class="table__empty table__empty--error">${message}</li>`,
    itemLabel: "alertas",
  });
  const load = () => alerts.reload();

  list.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-alert-id]");
    if (!button) return;
    const { alertId, alertStatus } = button.dataset;
    button.disabled = true;
    try {
      // Solo se re-renderiza la alerta cambiada (no la lista entera).
      const updated = await alertsApi.updateStatus(alertId, alertStatus);
      alerts.replaceItem(alertId, () => updated);
      list.querySelector(`[data-alert-item="${CSS.escape(alertId)}"]`).outerHTML = alertItemHtml(updated);
      liveStatus.textContent = alertStatus === "resolved" ? "Alerta resuelta." : "Alerta marcada como vista.";
      // El botón pulsado desaparece al re-renderizar: el foco pasa a la alerta.
      list.querySelector(`[data-alert-item="${CSS.escape(alertId)}"]`)?.focus();
    } catch (err) {
      showToast(err.message, "error");
      button.disabled = false;
    }
  });

  return { load };
}

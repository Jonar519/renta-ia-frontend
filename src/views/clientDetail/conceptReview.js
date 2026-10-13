import { clientsApi } from "../../api/clients.api.js";
import { setPending } from "../../components/states.js";
import { showErrorToast, showToast } from "../../components/toast.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

/**
 * Revisión de conceptos (B16). Se descarga recién al primer "Revisar" (o al
 * 409 de reprocesar): el chunk del detalle de cliente tiene su propio tope.
 *
 *  - startReview: formulario en la celda; la persona confirma el monto de la
 *    IA o lo corrige. Queda quién y cuándo (la API).
 *  - confirmDiscardReviews: D6, confirmación explícita de "descartar
 *    revisiones" antes de reprocesar un documento con conceptos revisados.
 */

/**
 * "1.450.000,50", "1450000.5", "$ 1.500.000" → número; null si no es un monto
 * válido (negativo, más de 2 decimales, texto).
 */
export function parseAmount(text) {
  let s = String(text).replace(/[\s$]/g, "");
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1 || /^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return n <= 999_999_999_999.99 ? n : null;
}

/**
 * Abre el formulario de revisión en `cell`. onReviewed(conceptoActualizado)
 * repinta la fila; onCancel la deja como estaba. `formatCOP` lo pasa el detalle
 * de cliente: si este módulo lo importara de labels.js, el chunk del detalle
 * dejaría de ser el de su ruta (Rollup lo convertiría en compartido).
 */
export function startReview(cell, concept, { clientId, formatCOP, onReviewed, onCancel }) {
  const id = `review-${concept.id}`;
  cell.innerHTML = `
    <form class="concept-review" novalidate>
      <label for="${id}">Monto revisado (COP)</label>
      <input id="${id}" name="amount" inputmode="decimal" autocomplete="off" required
        value="${escapeHtml(Number(concept.amount).toLocaleString("es-CO"))}" aria-describedby="${id}-hint ${id}-error" />
      <p class="form-hint" id="${id}-hint">La IA leyó ${escapeHtml(formatCOP(concept.aiAmount))}.</p>
      <p class="form-hint form-hint--error" id="${id}-error" role="alert"></p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost btn--small" data-review-cancel>Cancelar</button>
        <button type="submit" class="btn btn--primary btn--small">Confirmar</button>
      </div>
    </form>`;
  const form = cell.querySelector("form");
  const input = form.querySelector("input");
  const error = form.querySelector("[role=alert]");
  input.focus();
  input.select();

  form.querySelector("[data-review-cancel]").addEventListener("click", onCancel);
  form.addEventListener("keydown", (event) => {
    if (event.key === "Escape") onCancel();
  });
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const amount = parseAmount(input.value);
    if (amount === null) {
      error.textContent = "Escribe un monto válido: sin signo y con máximo 2 decimales (por ejemplo 1.450.000,50).";
      input.focus();
      return;
    }
    const done = setPending(form.querySelector("button[type=submit]"), "Guardando…");
    try {
      onReviewed(await clientsApi.reviewConcept(clientId, concept.id, amount));
    } catch (err) {
      done();
      error.textContent = err.message;
      showErrorToast(err);
      input.focus();
    }
  });
}

/**
 * Clic en "Revisar"/"Cambiar" de la fila (la conecta el detalle de cliente,
 * que pasa su estado: la lista de conceptos y cómo pintar fila y totales).
 */
export function openReview(button, { clientId, concepts, formatCOP, reviewCellHtml, conceptRowHtml, refreshTotals }) {
  const concept = concepts.find((c) => c.id === button.dataset.reviewId);
  if (!concept) return;
  const row = button.closest("tr");
  const cell = button.closest("td");
  const tbody = row.parentElement;
  const focusAction = (r) => r?.querySelector("button[data-review-id]")?.focus();
  startReview(cell, concept, {
    clientId,
    formatCOP,
    onCancel: () => {
      cell.innerHTML = reviewCellHtml(concept);
      focusAction(row);
    },
    onReviewed: (updated) => {
      const merged = { ...concept, ...updated };
      concepts[concepts.indexOf(concept)] = merged;
      row.outerHTML = conceptRowHtml(merged, { justReviewed: true });
      // Los totales usan el monto vigente: se recalculan con el revisado.
      refreshTotals();
      focusAction(tbody.querySelector(`tr[data-concept-id="${CSS.escape(merged.id)}"]`));
      showToast("Concepto revisado.", "success");
    },
  });
}

/**
 * D6: confirmación explícita antes de reprocesar un documento con conceptos
 * revisados. Resuelve true si la persona elige descartar las revisiones.
 */
export function confirmDiscardReviews(message) {
  return new Promise((resolve) => {
    document.body.insertAdjacentHTML(
      "beforeend",
      `<dialog class="dialog" id="discard-reviews-dialog" aria-labelledby="discard-reviews-title" aria-describedby="discard-reviews-text">
        <h2 id="discard-reviews-title">¿Descartar las revisiones?</h2>
        <p id="discard-reviews-text">${escapeHtml(message)} La IA volverá a extraer los conceptos de este documento y quedarán sin revisar. Esta decisión queda registrada.</p>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-dialog="back" autofocus>Volver</button>
          <button type="button" class="btn btn--primary btn--danger-fill" data-dialog="confirm">Descartar revisiones y reprocesar</button>
        </div>
      </dialog>`
    );
    const dialog = document.getElementById("discard-reviews-dialog");
    let confirmed = false;
    dialog.addEventListener("click", (event) => {
      const action = event.target.closest("[data-dialog]")?.dataset.dialog;
      if (!action) return;
      confirmed = action === "confirm";
      dialog.close();
    });
    dialog.addEventListener("close", () => {
      dialog.remove();
      resolve(confirmed);
    });
    dialog.showModal();
  });
}

import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * Estados explícitos de cada vista (docs/ui-states.md): cargando (skeleton),
 * error con "Reintentar" (sin recargar la página) y vacío con un mensaje que
 * orienta qué hacer. Todo devuelve HTML ya escapado.
 *
 * Los skeletons son ESTÁTICOS (sin shimmer): la única animación continua del
 * sistema es el indicador "procesando con IA" (.ai-processing, decisión D4).
 * Son aria-hidden; lo que oye un lector de pantalla es el texto oculto
 * "Cargando …" y el aria-busy del contenedor.
 */

// Anchos variados para que no parezca una cuadrícula. Clases y no style="…":
// la CSP (style-src 'self') bloquea los estilos en línea.
const WIDTHS = 6;
const w = (i) => `skeleton--w${(i % WIDTHS) + 1}`;

/** Filas skeleton para un <tbody>. */
export function skeletonRowsHtml(columns, { rows = 5, label = "Cargando…" } = {}) {
  const row = (r) =>
    `<tr class="skeleton-row" aria-hidden="true">${Array.from(
      { length: columns },
      (_, c) => `<td><span class="skeleton ${w(r + c)}"></span></td>`
    ).join("")}</tr>`;
  return (
    `<tr class="state-sr"><td colspan="${columns}"><span class="visually-hidden">${escapeHtml(label)}</span></td></tr>` +
    Array.from({ length: rows }, (_, r) => row(r)).join("")
  );
}

/** Ítems skeleton para una lista (<ul>). */
export function skeletonItemsHtml({ items = 3, label = "Cargando…" } = {}) {
  return (
    `<li class="state-sr"><span class="visually-hidden">${escapeHtml(label)}</span></li>` +
    Array.from(
      { length: items },
      (_, i) =>
        `<li class="skeleton-item" aria-hidden="true"><span class="skeleton skeleton--pill"></span><span class="skeleton-item__lines"><span class="skeleton ${w(i)}"></span><span class="skeleton ${w(i + 2)}"></span></span></li>`
    ).join("")
  );
}

/** Bloque skeleton genérico (párrafos, resúmenes). */
export function skeletonBlockHtml({ lines = 4, label = "Cargando…" } = {}) {
  return `<div class="skeleton-block"><span class="visually-hidden">${escapeHtml(label)}</span>${Array.from(
    { length: lines },
    (_, i) => `<span class="skeleton ${w(i)}" aria-hidden="true"></span>`
  ).join("")}</div>`;
}

function stateBody({ tone, title, message, action }) {
  return `<div class="state state--${tone}">
    <p class="state__title">${escapeHtml(title)}</p>
    ${message ? `<p class="state__message">${escapeHtml(message)}</p>` : ""}
    ${action ?? ""}
  </div>`;
}

/**
 * Error con botón "Reintentar". El botón lleva data-retry: quien pinta el
 * estado escucha el clic (delegado) y vuelve a pedir SOLO esos datos.
 */
export function errorStateHtml(
  message,
  { title = "No se pudieron cargar los datos.", retryLabel = "Reintentar" } = {}
) {
  return stateBody({
    tone: "error",
    title,
    message,
    action: `<button type="button" class="btn btn--ghost btn--small" data-retry>${escapeHtml(retryLabel)}</button>`,
  });
}

/** Vacío: qué pasa y qué puede hacer el usuario. */
export function emptyStateHtml(title, hint = "") {
  return stateBody({ tone: "empty", title, message: hint });
}

/** Envuelve un estado en una fila que ocupa toda la tabla. */
export const inRow = (columns, html) => `<tr class="state-row"><td colspan="${columns}">${html}</td></tr>`;

/** Envuelve un estado en un ítem de lista. */
export const inItem = (html) => `<li class="state-row">${html}</li>`;

/**
 * Estado "enviando" de un botón de formulario: deshabilitado, con el texto
 * de la acción en curso y aria-busy. Devuelve la función que lo restaura.
 */
export function setPending(button, text) {
  const original = button.textContent;
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.textContent = text;
  return () => {
    button.disabled = false;
    button.removeAttribute("aria-busy");
    button.textContent = original;
  };
}

/**
 * Enlaza los botones [data-retry] dentro de `container` con `retry`. Delegado:
 * sirve aunque el estado de error se pinte varias veces.
 */
export function bindRetry(container, retry) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("[data-retry]");
    if (!button || !container.contains(button)) return;
    button.disabled = true;
    retry();
  });
}

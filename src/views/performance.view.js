import { metricsApi } from "../api/metrics.api.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { bindRetry, emptyStateHtml, errorStateHtml, inRow, skeletonRowsHtml } from "../components/states.js";

const loadingHtml = skeletonRowsHtml(5, { label: "Cargando métricas…" });

// Umbrales de web.dev (bueno ≤ primero, "necesita mejorar" ≤ segundo, si no "malo").
// FID es histórico: se muestra solo como referencia (ver texto de la vista).
export const THRESHOLDS = {
  LCP: [2500, 4000],
  INP: [200, 500],
  CLS: [0.1, 0.25],
  FCP: [1800, 3000],
  TTFB: [800, 1800],
  FID: [100, 300],
};
const UNITS = { CLS: "" };
const ORDER = ["LCP", "INP", "CLS", "FCP", "TTFB", "FID", "LOAF", "LONG_TASK"];
const LABELS = {
  LCP: "LCP · pintado del contenido más grande",
  INP: "INP · respuesta a interacciones",
  CLS: "CLS · estabilidad visual",
  FCP: "FCP · primer contenido",
  TTFB: "TTFB · primer byte",
  FID: "FID · retardo de la primera interacción (histórico)",
  LOAF: "Frames largos (LoAF)",
  LONG_TASK: "Tareas largas (> 50 ms)",
};

export function ratingFor(metric, p75) {
  const t = THRESHOLDS[metric];
  if (!t) return null;
  if (p75 <= t[0]) return { text: "Bueno", tone: "success" };
  if (p75 <= t[1]) return { text: "Necesita mejorar", tone: "warning" };
  return { text: "Malo", tone: "error" };
}

const format = (metric, value) =>
  metric === "CLS" ? value.toFixed(3) : `${Math.round(value).toLocaleString("es-CO")}${UNITS[metric] ?? " ms"}`;

function rowsHtml(rows) {
  const sorted = [...rows].sort(
    (a, b) => ORDER.indexOf(a.metric) - ORDER.indexOf(b.metric) || String(a.route).localeCompare(String(b.route))
  );
  return sorted
    .map((r) => {
      const rating = ratingFor(r.metric, r.p75);
      return `
        <tr class="${r.route === null ? "perf-row--total" : ""}">
          <th scope="row">${escapeHtml(LABELS[r.metric] ?? r.metric)}</th>
          <td>${r.route === null ? "<strong>Todas</strong>" : `<code>${escapeHtml(r.route)}</code>`}</td>
          <td class="num num--end">${format(r.metric, r.p75)}</td>
          <td>${rating ? `<span class="badge badge--${rating.tone}">${rating.text}</span>` : "—"}</td>
          <td class="num num--end">${r.samples.toLocaleString("es-CO")}</td>
        </tr>`;
    })
    .join("");
}

export async function renderPerformance(root) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("performance")}
      <main class="main" id="main-content" tabindex="-1">
        <header class="main__header">
          <div>
            <h1 class="page-title">Rendimiento</h1>
            <p class="page-subtitle">Métricas de usuarios reales (percentil 75), anónimas: sin usuario, IP ni URL completa.</p>
          </div>
        </header>
        <section class="panel">
          <form id="perf-filters" class="upload-form">
            <label>Período
              <select name="days">
                <option value="1">Últimas 24 horas</option>
                <option value="7" selected>Últimos 7 días</option>
                <option value="30">Últimos 30 días</option>
              </select>
            </label>
            <label>Dispositivo
              <select name="device">
                <option value="">Todos</option>
                <option value="mobile">Móvil</option>
                <option value="tablet">Tablet</option>
                <option value="desktop">Escritorio</option>
              </select>
            </label>
          </form>
          <table class="table" id="perf-table" aria-busy="true">
            <caption class="visually-hidden">Percentil 75 de cada métrica por ruta</caption>
            <thead><tr><th scope="col">Métrica</th><th scope="col">Ruta</th><th scope="col" class="num--end">p75</th><th scope="col">Evaluación</th><th scope="col" class="num--end">Muestras</th></tr></thead>
            <tbody>${loadingHtml}</tbody>
          </table>
          <p class="form-hint">
            INP (Interaction to Next Paint) reemplazó a FID como Core Web Vital en marzo de 2024: FID solo medía la espera
            antes de atender la primera interacción; INP mide la latencia completa de todas las interacciones. FID se
            conserva aquí solo como referencia histórica.
          </p>
        </section>
      </main>
    </div>
  `;
  bindSidebarEvents(root);

  const form = root.querySelector("#perf-filters");
  const table = root.querySelector("#perf-table");
  const tbody = table.querySelector("tbody");

  // Cada carga tiene un número: si cambian el filtro dos veces seguidas, la
  // respuesta vieja no pisa a la nueva.
  let requestId = 0;
  async function load() {
    const current = ++requestId;
    table.setAttribute("aria-busy", "true");
    // Al cambiar un filtro, la tabla anterior se reemplaza por el skeleton:
    // así no se confunden cifras viejas con las del filtro nuevo.
    tbody.innerHTML = loadingHtml;
    try {
      const { rows } = await metricsApi.webVitalsSummary({
        days: form.days.value,
        device: form.device.value || undefined,
      });
      if (current !== requestId) return;
      tbody.innerHTML = rows.length
        ? rowsHtml(rows)
        : inRow(
            5,
            emptyStateHtml(
              "Todavía no hay métricas en este período.",
              'Se registran solas mientras la gente usa la app. Prueba con un período más largo o con "Todos" los dispositivos.'
            )
          );
    } catch (err) {
      if (err.name === "AbortError" || current !== requestId) return;
      tbody.innerHTML = inRow(5, errorStateHtml(err.message, { title: "No se pudieron cargar las métricas." }));
    } finally {
      if (current === requestId) table.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("change", load);
  bindRetry(tbody, load);
  await load();
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderPerformance(root);

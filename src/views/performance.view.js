import { metricsApi } from "../api/metrics.api.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { escapeHtml } from "../utils/escapeHtml.js";

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
          <td>${format(r.metric, r.p75)}</td>
          <td>${rating ? `<span class="badge badge--${rating.tone}">${rating.text}</span>` : "—"}</td>
          <td>${r.samples.toLocaleString("es-CO")}</td>
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
            <thead><tr><th scope="col">Métrica</th><th scope="col">Ruta</th><th scope="col">p75</th><th scope="col">Evaluación</th><th scope="col">Muestras</th></tr></thead>
            <tbody><tr><td colspan="5" class="table__empty">Cargando...</td></tr></tbody>
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

  async function load() {
    table.setAttribute("aria-busy", "true");
    try {
      const { rows } = await metricsApi.webVitalsSummary({
        days: form.days.value,
        device: form.device.value || undefined,
      });
      tbody.innerHTML = rows.length
        ? rowsHtml(rows)
        : `<tr><td colspan="5" class="table__empty">Todavía no hay métricas en este período.</td></tr>`;
    } catch (err) {
      tbody.innerHTML = `<tr><td colspan="5" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    } finally {
      table.removeAttribute("aria-busy");
    }
  }

  form.addEventListener("change", load);
  await load();
}

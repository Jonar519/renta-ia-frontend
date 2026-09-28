import { clientsApi } from "../../api/clients.api.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { formatCOP } from "./labels.js";

export function summaryPanelHtml() {
  return `
    <section class="panel">
      <h2>Resumen ejecutivo</h2>
      <p class="page-subtitle">Totales calculados por el sistema a partir de los conceptos extraídos y un texto redactado por IA con esas mismas cifras.</p>
      <form id="summary-form" class="upload-form">
        <label>Año gravable
          <select name="periodYear" id="summary-year">
            <option value="">El más reciente</option>
          </select>
        </label>
        <button type="submit" class="btn btn--primary" id="summary-btn">Generar resumen</button>
      </form>
      <div id="summary-result" class="summary" aria-live="polite"></div>
    </section>
  `;
}

const TOTAL_ROWS = [
  ["grossIncome", "Ingresos brutos"],
  ["pensionContribution", "Aportes a pensión"],
  ["healthContribution", "Aportes a salud"],
  ["deductions", "Deducciones reportadas"],
  ["withholding", "Retenciones en la fuente"],
];

function summaryHtml(s) {
  const totals = TOTAL_ROWS.map(
    ([key, label]) => `<tr><th scope="row">${label}</th><td>${formatCOP(s.totals[key])}</td></tr>`
  ).join("");

  const e = s.estimate;
  const estimate = e
    ? `
      <h3>Estimación simplificada</h3>
      <table class="table table--compact">
        <caption class="visually-hidden">Estimación del impuesto y del saldo</caption>
        <tbody>
          <tr><th scope="row">Deducciones aceptadas (con topes)</th><td>${formatCOP(e.deductionsApplied)}</td></tr>
          <tr><th scope="row">Base gravable estimada</th><td>${formatCOP(e.taxableBase)}</td></tr>
          <tr><th scope="row">Impuesto estimado</th><td>${formatCOP(e.estimatedTax)}</td></tr>
          <tr><th scope="row">${e.estimatedBalance >= 0 ? "Saldo estimado a pagar" : "Saldo estimado a favor"}</th>
              <td><strong>${formatCOP(Math.abs(e.estimatedBalance))}</strong></td></tr>
        </tbody>
      </table>
      ${e.rulesVerified ? "" : `<p class="form-hint">Parámetros tributarios (UVT, tarifas) pendientes de verificar contra la normativa vigente.</p>`}`
    : `<p class="form-hint">No hay parámetros (UVT) configurados para estimar el saldo del año ${escapeHtml(String(s.periodYear))}.</p>`;

  const text = s.text
    ? `<blockquote class="summary__text">${escapeHtml(s.text)}</blockquote>`
    : `<p class="form-hint form-hint--error">No se pudo redactar el texto con IA${s.textError ? `: ${escapeHtml(s.textError)}` : ""}. Las cifras de arriba sí están calculadas.</p>`;

  return `
    <h3>Año gravable ${escapeHtml(String(s.periodYear))}</h3>
    <table class="table table--compact">
      <caption class="visually-hidden">Totales del año gravable</caption>
      <tbody>${totals}</tbody>
    </table>
    ${estimate}
    <h3>Resumen redactado</h3>
    ${text}
    <p class="summary__disclaimer" role="note">${escapeHtml(s.disclaimer)}</p>
  `;
}

export function createSummarySection(root, clientId) {
  const form = root.querySelector("#summary-form");
  const button = root.querySelector("#summary-btn");
  const yearSelect = root.querySelector("#summary-year");
  const result = root.querySelector("#summary-result");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    button.disabled = true;
    button.textContent = "Generando...";
    result.setAttribute("aria-busy", "true");
    try {
      const year = yearSelect.value ? Number(yearSelect.value) : undefined;
      const summary = await clientsApi.summary(clientId, year);
      // Llena el selector con los años disponibles (una sola vez).
      if (yearSelect.options.length === 1) {
        for (const y of summary.availableYears) yearSelect.add(new Option(String(y), String(y)));
      }
      result.innerHTML = summaryHtml(summary);
    } catch (err) {
      result.innerHTML = `<p class="form-hint form-hint--error">${escapeHtml(err.message)}</p>`;
    } finally {
      result.removeAttribute("aria-busy");
      button.disabled = false;
      button.textContent = "Generar resumen";
    }
  });
}

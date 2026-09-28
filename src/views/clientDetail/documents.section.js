import { clientsApi } from "../../api/clients.api.js";
import { documentsApi } from "../../api/documents.api.js";
import { showToast } from "../../components/toast.js";
import { createPagedList } from "../../components/pagedList.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { appendInBatches } from "../../utils/scheduling.js";
import { aggregateConcepts } from "../../utils/aggregateConcepts.js";
import { createWorkerClient } from "../../workers/workerClient.js";
import { CONCEPT_LABELS, DOC_TYPE_LABELS, canReprocess, documentStatus, formatCOP, isPending } from "./labels.js";

// A partir de cuántos conceptos la agregación va al Web Worker. Por debajo,
// crear el worker y copiar los datos (structured clone) cuesta más que sumar.
export const WORKER_AGGREGATION_THRESHOLD = 500;
// Filas de conceptos que se pintan de entrada; el resto, con "Mostrar más".
const CONCEPT_ROWS_INITIAL = 100;
const CONCEPT_ROWS_STEP = 200;

export function documentsPanelHtml() {
  return `
    <section class="panel">
      <h2>Subir documento</h2>
      <form id="upload-form" class="upload-form">
        <label>Tipo de documento
          <select name="docType" required>
            ${Object.entries(DOC_TYPE_LABELS)
              .map(([value, label]) => `<option value="${value}">${label}</option>`)
              .join("")}
          </select>
        </label>
        <label>Archivo (PDF, JPG o PNG · máx. 15 MB)
          <input type="file" name="file" accept=".pdf,.jpg,.jpeg,.png" required />
        </label>
        <button type="submit" class="btn btn--primary" id="upload-btn">Subir y analizar con IA</button>
      </form>
      <p id="upload-status" class="form-hint" role="status" aria-live="polite"></p>
    </section>

    <section class="panel panel--deferred">
      <h2>Conceptos tributarios extraídos</h2>
      <div id="concepts-totals"></div>
      <table class="table" id="concepts-table">
        <caption class="visually-hidden">Conceptos tributarios extraídos por la IA de los documentos del cliente</caption>
        <thead><tr><th scope="col">Concepto</th><th scope="col">Descripción</th><th scope="col">Monto</th><th scope="col">Año</th></tr></thead>
        <tbody><tr><td colspan="4" class="table__empty">Cargando...</td></tr></tbody>
      </table>
      <div class="load-more">
        <button type="button" class="btn btn--ghost" id="concepts-more" aria-controls="concepts-table" hidden>Mostrar más conceptos</button>
      </div>
    </section>

    <section class="panel panel--deferred">
      <h2>Documentos</h2>
      <table class="table" id="documents-table">
        <caption class="visually-hidden">Documentos subidos y su estado de procesamiento</caption>
        <thead><tr>
          <th scope="col">Archivo</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Subido</th>
          <th scope="col"><span class="visually-hidden">Acciones</span></th>
        </tr></thead>
        <tbody id="documents-tbody"><tr><td colspan="5" class="table__empty">Cargando...</td></tr></tbody>
      </table>
      <div class="load-more">
        <button type="button" class="btn btn--ghost" id="documents-more" aria-controls="documents-tbody" hidden>Cargar más documentos</button>
        <p class="visually-hidden" id="documents-status" role="status" aria-live="polite"></p>
      </div>
    </section>
  `;
}

function documentRowHtml(d) {
  const status = documentStatus(d);
  const action = canReprocess(d)
    ? `<button type="button" class="btn btn--ghost btn--small" data-reprocess-id="${escapeHtml(d.id)}">Reintentar análisis<span class="visually-hidden"> de ${escapeHtml(d.originalName)}</span></button>`
    : "";
  return `
    <tr data-document-id="${escapeHtml(d.id)}">
      <td class="table__primary">${escapeHtml(d.originalName)}</td>
      <td>${DOC_TYPE_LABELS[d.docType] || escapeHtml(d.docType)}</td>
      <td>
        <span class="badge badge--${status.tone}">${escapeHtml(status.text)}</span>
        ${status.detail ? `<p class="table__note">${escapeHtml(status.detail)}</p>` : ""}
      </td>
      <td>${new Date(d.uploadedAt).toLocaleString("es-CO")}</td>
      <td>${action}</td>
    </tr>`;
}

const conceptRowHtml = (c) => `
  <tr>
    <td class="table__primary">${CONCEPT_LABELS[c.conceptType] || escapeHtml(c.conceptType)}</td>
    <td>${escapeHtml(c.description || "—")}</td>
    <td>${formatCOP(c.amount)}</td>
    <td>${escapeHtml(String(c.periodYear))}</td>
  </tr>`;

const TOTAL_COLUMNS = ["gross_income", "withholding", "deduction", "pension_contribution", "health_contribution"];

function totalsHtml(rows) {
  if (rows.length === 0) return "";
  return `
    <table class="table table--compact table--totals">
      <caption>Totales por año gravable</caption>
      <thead><tr><th scope="col">Año</th>${TOTAL_COLUMNS.map((t) => `<th scope="col">${CONCEPT_LABELS[t]}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><th scope="row">${r.periodYear}</th>${TOTAL_COLUMNS.map((t) => `<td>${formatCOP(r.totals[t] ?? 0)}</td>`).join("")}</tr>`
        )
        .join("")}</tbody>
    </table>`;
}

/**
 * Sección "Documentos": subida (validación + SHA-256 en un Web Worker),
 * documentos paginados con reintento, y conceptos con totales por año.
 *
 * @param {{ signal: AbortSignal, onProcessed?: () => void }} options  signal se aborta al salir de la vista
 */
export function createDocumentsSection(root, clientId, { signal, onProcessed = () => {} }) {
  const docsTbody = root.querySelector("#documents-tbody");
  const conceptsTbody = root.querySelector("#concepts-table tbody");
  const conceptsTotals = root.querySelector("#concepts-totals");
  const conceptsMore = root.querySelector("#concepts-more");

  const uploadWorker = createWorkerClient(
    () => new Worker(new URL("../../workers/upload.worker.js", import.meta.url), { type: "module" })
  );
  const conceptsWorker = createWorkerClient(
    () => new Worker(new URL("../../workers/concepts.worker.js", import.meta.url), { type: "module" })
  );
  signal.addEventListener("abort", () => {
    uploadWorker.terminate();
    conceptsWorker.terminate();
  });

  const documents = createPagedList({
    container: docsTbody,
    moreButton: root.querySelector("#documents-more"),
    status: root.querySelector("#documents-status"),
    fetchPage: (cursor) => documentsApi.listByClient(clientId, { cursor }),
    renderItem: documentRowHtml,
    emptyHtml: `<tr><td colspan="5" class="table__empty">Todavía no se han subido documentos.</td></tr>`,
    errorHtml: (message) => `<tr><td colspan="5" class="table__empty table__empty--error">${message}</td></tr>`,
    itemLabel: "documentos",
  });

  // --- Conceptos: totales (Worker si la lista es grande) + tabla por partes ---
  let concepts = [];
  let conceptsShown = 0;
  let conceptsAbort = null;

  async function showMoreConcepts(count) {
    const next = concepts.slice(conceptsShown, conceptsShown + count);
    conceptsShown += next.length;
    conceptsMore.hidden = conceptsShown >= concepts.length;
    conceptsMore.textContent = `Mostrar más conceptos (${concepts.length - conceptsShown} restantes)`;
    await appendInBatches(conceptsTbody, next, conceptRowHtml, { signal: conceptsAbort.signal });
  }

  async function loadConcepts() {
    conceptsAbort?.abort(); // una recarga cancela la anterior (y su agregación en el worker)
    conceptsAbort = new AbortController();
    const { signal: loadSignal } = conceptsAbort;
    try {
      // Una sola llamada para todos los conceptos del cliente (sin N+1).
      concepts = await clientsApi.getTaxConcepts(clientId);
      if (loadSignal.aborted) return;
      const totals =
        concepts.length >= WORKER_AGGREGATION_THRESHOLD
          ? await conceptsWorker.run("aggregate", { concepts }, { signal: loadSignal })
          : aggregateConcepts(concepts);
      conceptsTotals.innerHTML = totalsHtml(totals);
      conceptsTbody.innerHTML =
        concepts.length === 0
          ? `<tr><td colspan="4" class="table__empty">Aún no hay conceptos extraídos por la IA.</td></tr>`
          : "";
      conceptsShown = 0;
      if (concepts.length) await showMoreConcepts(CONCEPT_ROWS_INITIAL);
      else conceptsMore.hidden = true;
    } catch (err) {
      if (err.name === "AbortError") return;
      conceptsTbody.innerHTML = `<tr><td colspan="4" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    }
  }
  conceptsMore.addEventListener("click", () => showMoreConcepts(CONCEPT_ROWS_STEP));

  /**
   * Aplica un evento del WebSocket: actualiza SOLO la fila del documento (sin
   * volver a pedir la lista). Si no está entre los cargados (p. ej. lo subió
   * otra pestaña), recarga la primera página.
   */
  function applyEvent(event) {
    const updated = documents.replaceItem(event.documentId, (d) => ({
      ...d,
      status: event.status,
      errorMessage: event.errorMessage,
    }));
    if (!updated) {
      documents.reload();
      return;
    }
    const row = docsTbody.querySelector(`tr[data-document-id="${CSS.escape(event.documentId)}"]`);
    if (row) row.outerHTML = documentRowHtml(updated);
    if (event.status === "processed") {
      loadConcepts();
      onProcessed();
    }
  }

  docsTbody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-reprocess-id]");
    if (!button) return;
    button.disabled = true;
    try {
      const updated = await documentsApi.reprocess(button.dataset.reprocessId);
      applyEvent({ documentId: updated.id, status: updated.status, errorMessage: updated.errorMessage });
      showToast("Análisis reencolado. El estado se actualizará solo.", "success");
    } catch (err) {
      showToast(err.message, "error");
      button.disabled = false;
    }
  });

  // --- Subida: validar y calcular el SHA-256 en el Worker, consultar duplicados, subir ---
  const uploadForm = root.querySelector("#upload-form");
  const uploadStatus = root.querySelector("#upload-status");
  const uploadBtn = root.querySelector("#upload-btn");
  const fileInput = uploadForm.querySelector('input[type="file"]');
  let uploadAbort = null;

  function setStatus(text, isError = false) {
    uploadStatus.classList.toggle("form-hint--error", isError);
    uploadStatus.textContent = text;
  }

  // Elegir otro archivo cancela el cálculo de la huella del anterior.
  fileInput.addEventListener("change", () => uploadAbort?.abort());

  uploadForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = fileInput.files[0];
    if (!file) return;

    uploadAbort?.abort();
    uploadAbort = new AbortController();
    const runSignal = AbortSignal.any([uploadAbort.signal, signal]);
    uploadBtn.disabled = true;

    try {
      setStatus("Validando archivo...");
      const { valid, errors } = await uploadWorker.run(
        "validate",
        { name: file.name, size: file.size },
        { signal: runSignal }
      );
      if (!valid) {
        setStatus(errors.join(" "), true);
        return;
      }

      setStatus("Calculando la huella del archivo...");
      const { sha256 } = await uploadWorker.run("hash", { file }, { signal: runSignal });

      // Consulta previa: si ya existe, no se transfiere el archivo.
      const existing = await documentsApi.findByHash(clientId, sha256);
      if (existing.exists) {
        const when = new Date(existing.document.uploadedAt).toLocaleString("es-CO");
        setStatus(
          `Este archivo ya se subió como "${existing.document.originalName}" (${when}); no se volvió a subir.`,
          true
        );
        return;
      }

      setStatus("Subiendo y encolando para análisis con IA...");
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", clientId);
      formData.append("docType", uploadForm.docType.value);
      formData.append("sha256", sha256);
      await documentsApi.upload(formData);

      showToast("Documento subido. El análisis con IA corre en segundo plano.", "success");
      setStatus("Documento subido. Su estado se actualizará automáticamente.");
      uploadForm.reset();
      await documents.reload();
    } catch (err) {
      if (err.name === "AbortError") {
        setStatus("Se canceló la preparación del archivo anterior.");
        return;
      }
      showToast(err.message, "error");
      setStatus(err.message, true);
    } finally {
      uploadBtn.disabled = false;
    }
  });

  return {
    load: () => Promise.all([documents.reload(), loadConcepts()]),
    loadDocuments: () => documents.reload(),
    applyEvent,
    hasPending: () => documents.getItems().some(isPending),
    /** Firma de los estados, para que el polling sepa si algo cambió. */
    statusSignature: () =>
      documents
        .getItems()
        .map((d) => `${d.id}:${d.status}`)
        .join("|"),
  };
}

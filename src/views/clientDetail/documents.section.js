import { clientsApi } from "../../api/clients.api.js";
import { can } from "../../auth/permissions.js";
import { refreshSession } from "../../auth/session.js";
import { getState } from "../../state/store.js";
import { documentsApi } from "../../api/documents.api.js";
import { showErrorToast, showToast } from "../../components/toast.js";
import { createPagedList } from "../../components/pagedList.js";
import { bindDensityToggles, densityToggleHtml } from "../../components/densityToggle.js";
import { bindRetry, emptyStateHtml, errorStateHtml, inRow, skeletonRowsHtml } from "../../components/states.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { appendInBatches } from "../../utils/scheduling.js";
import { aggregateConcepts } from "../../utils/aggregateConcepts.js";
import { createWorkerClient } from "../../workers/workerClient.js";
import { CONCEPT_LABELS, DOC_TYPE_LABELS, canReprocess, documentStatus, formatCOP, isPending } from "./labels.js";

// A partir de cuántos conceptos la agregación va al Web Worker. Por debajo,
// crear el worker y copiar los datos (structured clone) cuesta más que sumar.
export const WORKER_AGGREGATION_THRESHOLD = 500;
// Filas de conceptos que se pintan de entrada; el resto, con "Mostrar más".
/**
 * El archivo original (B17): { blob, type }, o un Error con un mensaje para
 * mostrar tal cual. Exige sesión y un <img>, un canvas o un <a download> no
 * pueden mandar el token: se pide con fetch y se usa como blob: (como la foto
 * de perfil). Lo usan el visor (se le inyecta) y la descarga del portal.
 */
async function fetchDocumentFile(docId, retry = true) {
  let response;
  try {
    response = await fetch(
      `${import.meta.env.VITE_API_URL || "http://localhost:4000"}/api/documents/${encodeURIComponent(docId)}/file`,
      {
        headers: { Authorization: `Bearer ${getState().token}` },
      }
    );
  } catch {
    throw new Error("Sin conexión: no se pudo descargar el archivo.");
  }
  if (response.status === 401 && retry && (await refreshSession().catch(() => null))) {
    return fetchDocumentFile(docId, false);
  }
  if (response.status === 404) throw new Error("El archivo original de este documento no está disponible.");
  if (!response.ok) throw new Error("No se pudo abrir el archivo. Intenta de nuevo.");
  return { blob: await response.blob(), type: response.headers.get("content-type") ?? "" };
}

const CONCEPT_ROWS_INITIAL = 100;
const CONCEPT_ROWS_STEP = 200;

const conceptsLoadingHtml = skeletonRowsHtml(5, { label: "Cargando conceptos tributarios…" });
const documentsLoadingHtml = skeletonRowsHtml(5, { rows: 3, label: "Cargando documentos…" });

export function documentsPanelHtml() {
  // El portal del contribuyente (rol client) es de solo lectura: sin subida.
  const uploadPanel = can("document.write") ? uploadPanelHtml() : "";
  return `
    ${uploadPanel}

    <div class="split">
    <div id="document-viewer"></div>

    <section class="panel panel--deferred">
      <h2>Conceptos tributarios extraídos</h2>
      <div id="concepts-totals"></div>
      <p class="form-hint" id="concepts-filter" aria-live="polite" hidden></p>
      <table class="table table--stack" id="concepts-table">
        <caption class="visually-hidden">Conceptos tributarios extraídos por la IA de los documentos del cliente</caption>
        <thead><tr><th scope="col">Concepto</th><th scope="col">Descripción</th><th scope="col" class="num--end">Monto</th><th scope="col">Año</th><th scope="col">Revisión</th></tr></thead>
        <tbody>${conceptsLoadingHtml}</tbody>
      </table>
      <div class="load-more">
        <button type="button" class="btn btn--ghost" id="concepts-more" aria-controls="concepts-table" hidden>Mostrar más conceptos</button>
      </div>
    </section>
    </div>

    <section class="panel panel--deferred">
      <h2>Documentos</h2>
      <div class="table-toolbar">${densityToggleHtml()}</div>
      <table class="table table--stack" id="documents-table">
        <caption class="visually-hidden">Documentos subidos y su estado de procesamiento</caption>
        <thead><tr>
          <th scope="col">Archivo</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Subido</th>
          <th scope="col"><span class="visually-hidden">Acciones</span></th>
        </tr></thead>
        <tbody id="documents-tbody">${documentsLoadingHtml}</tbody>
      </table>
      <div class="load-more">
        <button type="button" class="btn btn--ghost" id="documents-more" aria-controls="documents-tbody" hidden>Cargar más documentos</button>
        <p class="visually-hidden" id="documents-status" role="status" aria-live="polite"></p>
      </div>
    </section>
  `;
}

function uploadPanelHtml() {
  return `
    <section class="panel">
      <h2>Subir documento</h2>
      <form id="upload-form" class="upload-form" data-requires-network>
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
    </section>`;
}

function documentRowHtml(d) {
  const status = documentStatus(d);
  const action =
    canReprocess(d) && can("document.write")
      ? `<button type="button" class="btn btn--ghost btn--small" data-requires-network data-reprocess-id="${escapeHtml(d.id)}">Reintentar análisis<span class="visually-hidden"> de ${escapeHtml(d.originalName)}</span></button>`
      : "";
  // El original (B17): en el visor; el portal, sin visor, solo lo descarga.
  const view = can("document.viewer")
    ? `<button type="button" class="btn btn--ghost btn--small" data-view-id="${escapeHtml(d.id)}">Ver original<span class="visually-hidden"> de ${escapeHtml(d.originalName)}</span></button>`
    : `<button type="button" class="btn btn--ghost btn--small" data-download-id="${escapeHtml(d.id)}">Descargar<span class="visually-hidden"> ${escapeHtml(d.originalName)}</span></button>`;
  return `
    <tr data-document-id="${escapeHtml(d.id)}">
      <td class="table__primary" data-label="Archivo">${escapeHtml(d.originalName)}</td>
      <td data-label="Tipo">${DOC_TYPE_LABELS[d.docType] || escapeHtml(d.docType)}</td>
      <td data-label="Estado">
        <span class="badge badge--${status.tone}${d.status === "processing" ? " ai-processing" : ""}">${escapeHtml(status.text)}</span>
        ${status.detail ? `<p class="table__note">${escapeHtml(status.detail)}</p>` : ""}
      </td>
      <td class="num" data-label="Subido">${new Date(d.uploadedAt).toLocaleString("es-CO")}</td>
      <td class="table__actions">${view} ${action}</td>
    </tr>`;
}

/**
 * Estado de revisión (B16, D5): sin revisar → badge violeta "Extraído por IA ·
 * sin revisar" (lo dice tal cual: nada lo validó todavía); revisado → quién,
 * y si se corrigió, qué había leído la IA (esto último, solo al equipo del contador). `justReviewed`: la única
 * micro-interacción del badge, una vez, al quedar revisado.
 */
function reviewCellHtml(c, { justReviewed = false } = {}) {
  const action = can("document.write")
    ? `<button type="button" class="btn btn--ghost btn--small" data-review-id="${escapeHtml(c.id)}">${c.reviewed ? "Cambiar" : "Revisar"}<span class="visually-hidden"> ${CONCEPT_LABELS[c.conceptType] || escapeHtml(c.conceptType)} ${escapeHtml(String(c.periodYear))}</span></button>`
    : "";
  if (!c.reviewed) return `<span class="badge badge--ai">Extraído por IA · sin revisar</span> ${action}`;
  const corrected =
    c.source === "person" ? `<p class="table__note">Corregido · la IA leyó ${formatCOP(c.aiAmount)}</p>` : "";
  // Quién lo revisó y lo que leyó la IA solo llegan al equipo del contador (la API no los manda al portal).
  const by = c.reviewer ? `<p class="table__note">por ${escapeHtml(c.reviewer.name)}</p>` : "";
  return `<span class="badge badge--success${justReviewed ? " badge--reviewed-now" : ""}">Revisado</span> ${action}${by}${corrected}`;
}

const conceptRowHtml = (c, options) => `
  <tr data-concept-id="${escapeHtml(c.id)}">
    <td class="table__primary" data-label="Concepto">${CONCEPT_LABELS[c.conceptType] || escapeHtml(c.conceptType)}</td>
    <td data-label="Descripción">${escapeHtml(c.description || "—")}</td>
    <td class="num num--end" data-label="Monto">${formatCOP(c.amount)}</td>
    <td class="num" data-label="Año">${escapeHtml(String(c.periodYear))}</td>
    <td data-label="Revisión">${reviewCellHtml(c, options)}</td>
  </tr>`;

const TOTAL_COLUMNS = ["gross_income", "withholding", "deduction", "pension_contribution", "health_contribution"];

function totalsHtml(rows, unreviewed = 0) {
  if (rows.length === 0) return "";
  return `
    <div class="table-scroll" role="region" aria-label="Totales por año gravable" tabindex="0">
    <table class="table table--compact table--totals">
      <caption>Totales por año gravable</caption>
      <thead><tr><th scope="col">Año</th>${TOTAL_COLUMNS.map((t) => `<th scope="col">${CONCEPT_LABELS[t]}</th>`).join("")}</tr></thead>
      <tbody>${rows
        .map(
          (r) =>
            `<tr><th scope="row" class="num">${r.periodYear}</th>${TOTAL_COLUMNS.map((t) => `<td class="num num--end">${formatCOP(r.totals[t] ?? 0)}</td>`).join("")}</tr>`
        )
        .join("")}</tbody>
    </table>
    </div>
    ${unreviewed ? `<p class="form-hint">Incluye ${unreviewed === 1 ? "1 concepto extraído" : `${unreviewed} conceptos extraídos`} por IA sin revisar.</p>` : ""}`;
}

/**
 * Sección "Documentos": subida (validación + SHA-256 en un Web Worker),
 * documentos paginados con reintento, y conceptos con totales por año.
 *
 * @param {{ signal: AbortSignal, onProcessed?: () => void }} options  signal se aborta al salir de la vista
 */
export function createDocumentsSection(root, clientId, { signal, onProcessed = () => {} }) {
  const docsTbody = root.querySelector("#documents-tbody");
  bindDensityToggles(root);
  const conceptsTable = root.querySelector("#concepts-table");
  const conceptsTbody = conceptsTable.querySelector("tbody");
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
    loadingHtml: documentsLoadingHtml,
    emptyHtml: inRow(
      5,
      can("document.write")
        ? emptyStateHtml(
            "Todavía no se han subido documentos.",
            "Sube un certificado, extracto o factura arriba: la IA lo analizará y extraerá las cifras."
          )
        : emptyStateHtml("Todavía no hay documentos en tu expediente.", "Tu contador los subirá cuando los reciba.")
    ),
    errorHtml: (message) => inRow(5, errorStateHtml(message, { title: "No se pudieron cargar los documentos." })),
    itemLabel: "documentos",
  });

  // --- Conceptos: totales (Worker si la lista es grande) + tabla por partes ---
  let concepts = [];
  let conceptsShown = 0;
  let conceptsAbort = null;
  let rowsAbort = null;
  // Vista dividida (B18): con el original abierto, la tabla muestra solo los
  // conceptos de ese documento. Es la misma tabla (y la misma revisión de B16).
  let openDoc = null;
  const conceptsFilter = root.querySelector("#concepts-filter");
  const visibleConcepts = () => (openDoc ? concepts.filter((c) => c.documentId === openDoc.id) : concepts);

  async function showMoreConcepts(count) {
    const list = visibleConcepts();
    const next = list.slice(conceptsShown, conceptsShown + count);
    conceptsShown += next.length;
    conceptsMore.hidden = conceptsShown >= list.length;
    conceptsMore.textContent = `Mostrar más conceptos (${list.length - conceptsShown} restantes)`;
    await appendInBatches(conceptsTbody, next, conceptRowHtml, { signal: rowsAbort.signal });
  }

  /** Pinta las filas desde cero (al cargar, y al abrir o cerrar el original). */
  async function renderConcepts() {
    rowsAbort?.abort();
    rowsAbort = new AbortController();
    const list = visibleConcepts();
    conceptsFilter.hidden = !openDoc;
    if (openDoc) {
      conceptsFilter.textContent = `Conceptos de ${openDoc.originalName}: ${list.length} de ${concepts.length}. Los totales son de todo el cliente; al cerrar el original vuelven todos los conceptos.`;
    }
    conceptsTbody.innerHTML = list.length
      ? ""
      : inRow(
          5,
          openDoc
            ? emptyStateHtml(
                "Este documento no tiene conceptos extraídos.",
                "Si la IA aún lo está analizando, aparecen solos cuando termina."
              )
            : emptyStateHtml(
                "Aún no hay conceptos extraídos.",
                "Aparecen solos cuando la IA termina de analizar un documento de este cliente."
              )
        );
    conceptsShown = 0;
    if (list.length) await showMoreConcepts(CONCEPT_ROWS_INITIAL);
    else conceptsMore.hidden = true;
  }

  async function loadConcepts() {
    conceptsAbort?.abort(); // una recarga cancela la anterior (y su agregación en el worker)
    conceptsAbort = new AbortController();
    const { signal: loadSignal } = conceptsAbort;
    if (concepts.length === 0) conceptsTbody.innerHTML = conceptsLoadingHtml;
    conceptsTable.setAttribute("aria-busy", "true");
    try {
      // Una sola llamada para todos los conceptos del cliente (sin N+1).
      concepts = await clientsApi.getTaxConcepts(clientId);
      if (loadSignal.aborted) return;
      const totals =
        concepts.length >= WORKER_AGGREGATION_THRESHOLD
          ? await conceptsWorker.run("aggregate", { concepts }, { signal: loadSignal })
          : aggregateConcepts(concepts);
      conceptsTotals.innerHTML = totalsHtml(totals, unreviewedCount());
      await renderConcepts();
    } catch (err) {
      if (err.name === "AbortError") return;
      concepts = [];
      conceptsTotals.innerHTML = "";
      conceptsMore.hidden = true;
      conceptsTbody.innerHTML = inRow(
        5,
        errorStateHtml(err.message, { title: "No se pudieron cargar los conceptos tributarios." })
      );
    } finally {
      if (!loadSignal.aborted) conceptsTable.removeAttribute("aria-busy");
    }
  }
  bindRetry(conceptsTbody, () => loadConcepts());

  const unreviewedCount = () => concepts.reduce((n, c) => n + (c.reviewed ? 0 : 1), 0);

  // Revisar un concepto (B16): la lógica y el formulario se descargan al primer clic.
  conceptsTbody.addEventListener("click", async (event) => {
    const button = event.target.closest("button[data-review-id]");
    if (!button) return;
    const { openReview } = await import("./conceptReview.js");
    openReview(button, {
      clientId,
      concepts,
      formatCOP,
      reviewCellHtml,
      conceptRowHtml,
      refreshTotals: () => (conceptsTotals.innerHTML = totalsHtml(aggregateConcepts(concepts), unreviewedCount())),
    });
  });
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

  // Vista dividida I (B17): el visor se descarga al abrir "Ver original".
  let viewer = null;
  docsTbody.addEventListener("click", async (event) => {
    const downloadButton = event.target.closest("button[data-download-id]");
    if (downloadButton) {
      const doc = documents.getItems().find((d) => d.id === downloadButton.dataset.downloadId);
      if (!doc) return;
      downloadButton.disabled = true;
      try {
        const url = URL.createObjectURL((await fetchDocumentFile(doc.id)).blob);
        const link = Object.assign(document.createElement("a"), { href: url, download: doc.originalName });
        link.click();
        // El navegador ya tomó el blob al hacer clic; se libera después.
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      } catch (err) {
        showErrorToast(err);
      } finally {
        downloadButton.disabled = false;
      }
      return;
    }
    const viewButton = event.target.closest("button[data-view-id]");
    if (viewButton && can("document.viewer")) {
      const doc = documents.getItems().find((d) => d.id === viewButton.dataset.viewId);
      if (!doc) return;
      viewer?.close();
      const { openDocumentViewer } = await import("./documentViewer.js");
      const host = root.querySelector("#document-viewer");
      viewer = openDocumentViewer(host, doc, {
        fetchFile: fetchDocumentFile,
        onClose: () => {
          viewer = null;
          openDoc = null;
          renderConcepts();
          // La fila pudo volver a pintarse (el análisis terminó): el botón de ahora.
          docsTbody.querySelector(`button[data-view-id="${CSS.escape(doc.id)}"]`)?.focus();
        },
      });
      // Vista dividida (B18): junto al original, solo sus conceptos.
      openDoc = doc;
      renderConcepts();
      // Sin behavior: respeta scroll-behavior del CSS (y prefers-reduced-motion).
      host.scrollIntoView({ block: "start" });
      return;
    }
    const button = event.target.closest("button[data-reprocess-id]");
    if (!button) return;
    button.disabled = true;
    try {
      let updated;
      try {
        updated = await documentsApi.reprocess(button.dataset.reprocessId);
      } catch (err) {
        // D6: tiene conceptos revisados. Solo con la confirmación explícita.
        if (err.code !== "reviewed_concepts") throw err;
        const { confirmDiscardReviews } = await import("./conceptReview.js");
        if (!(await confirmDiscardReviews(err.message))) {
          button.disabled = false;
          button.focus();
          return;
        }
        updated = await documentsApi.reprocess(button.dataset.reprocessId, { discardReviews: true });
      }
      applyEvent({ documentId: updated.id, status: updated.status, errorMessage: updated.errorMessage });
      showToast("Análisis reencolado. El estado se actualizará solo.", "success");
    } catch (err) {
      showErrorToast(err);
      button.disabled = false;
    }
  });

  // --- Subida: validar y calcular el SHA-256 en el Worker, consultar duplicados, subir ---
  const uploadForm = root.querySelector("#upload-form");
  // Sin formulario (rol client, solo lectura) no hay nada que enlazar.
  if (uploadForm) {
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
        showErrorToast(err);
        setStatus(err.message, true);
      } finally {
        uploadBtn.disabled = false;
      }
    });
  }

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

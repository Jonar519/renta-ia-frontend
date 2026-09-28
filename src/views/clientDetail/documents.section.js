import { clientsApi } from "../../api/clients.api.js";
import { documentsApi } from "../../api/documents.api.js";
import { showToast } from "../../components/toast.js";
import { escapeHtml } from "../../utils/escapeHtml.js";
import { CONCEPT_LABELS, DOC_TYPE_LABELS, canReprocess, documentStatus, formatCOP, isPending } from "./labels.js";

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

    <section class="panel">
      <h2>Conceptos tributarios extraídos</h2>
      <table class="table" id="concepts-table">
        <caption class="visually-hidden">Conceptos tributarios extraídos por la IA de los documentos del cliente</caption>
        <thead><tr><th scope="col">Concepto</th><th scope="col">Descripción</th><th scope="col">Monto</th><th scope="col">Año</th></tr></thead>
        <tbody><tr><td colspan="4" class="table__empty">Cargando...</td></tr></tbody>
      </table>
    </section>

    <section class="panel">
      <h2>Documentos</h2>
      <table class="table" id="documents-table">
        <caption class="visually-hidden">Documentos subidos y su estado de procesamiento</caption>
        <thead><tr>
          <th scope="col">Archivo</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Subido</th>
          <th scope="col"><span class="visually-hidden">Acciones</span></th>
        </tr></thead>
        <tbody><tr><td colspan="5" class="table__empty">Cargando...</td></tr></tbody>
      </table>
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

/**
 * Sección "Documentos": subida (validada en un Web Worker), tabla de
 * documentos con reintento, y tabla de conceptos extraídos.
 */
export function createDocumentsSection(root, clientId, { onProcessed = () => {} } = {}) {
  const docsTbody = root.querySelector("#documents-table tbody");
  const conceptsTbody = root.querySelector("#concepts-table tbody");
  let documents = [];

  function renderDocuments() {
    docsTbody.innerHTML =
      documents.length === 0
        ? `<tr><td colspan="5" class="table__empty">Todavía no se han subido documentos.</td></tr>`
        : documents.map(documentRowHtml).join("");
  }

  async function loadDocuments() {
    try {
      documents = await documentsApi.listByClient(clientId);
      renderDocuments();
    } catch (err) {
      docsTbody.innerHTML = `<tr><td colspan="5" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    }
    return documents;
  }

  async function loadConcepts() {
    try {
      // Una sola llamada para todos los conceptos del cliente (sin N+1).
      const concepts = await clientsApi.getTaxConcepts(clientId);
      conceptsTbody.innerHTML =
        concepts.length === 0
          ? `<tr><td colspan="4" class="table__empty">Aún no hay conceptos extraídos por la IA.</td></tr>`
          : concepts
              .map(
                (c) => `
          <tr>
            <td class="table__primary">${CONCEPT_LABELS[c.conceptType] || escapeHtml(c.conceptType)}</td>
            <td>${escapeHtml(c.description || "—")}</td>
            <td>${formatCOP(c.amount)}</td>
            <td>${escapeHtml(String(c.periodYear))}</td>
          </tr>`
              )
              .join("");
    } catch (err) {
      conceptsTbody.innerHTML = `<tr><td colspan="4" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  /**
   * Aplica un evento del WebSocket: actualiza SOLO la fila del documento
   * (sin volver a pedir la lista). Si el documento no está en la lista (p.
   * ej. lo subió otra pestaña), recarga la lista.
   */
  function applyEvent(event) {
    const index = documents.findIndex((d) => d.id === event.documentId);
    if (index === -1) {
      loadDocuments();
      return;
    }
    documents[index] = { ...documents[index], status: event.status, errorMessage: event.errorMessage };
    const row = docsTbody.querySelector(`tr[data-document-id="${CSS.escape(event.documentId)}"]`);
    if (row) row.outerHTML = documentRowHtml(documents[index]);
    if (event.status === "processed") {
      loadConcepts();
      onProcessed();
    }
  }

  // Reintentar análisis (delegación de eventos: las filas se re-renderizan).
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

  // --- Subida de documentos, validada primero en un Web Worker ---
  const uploadForm = root.querySelector("#upload-form");
  const uploadStatus = root.querySelector("#upload-status");
  const uploadBtn = root.querySelector("#upload-btn");
  const validationWorker = new Worker(new URL("../../workers/fileValidation.worker.js", import.meta.url), {
    type: "module",
  });

  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const file = uploadForm.querySelector('input[type="file"]').files[0];
    if (!file) return;

    uploadStatus.classList.remove("form-hint--error");
    uploadStatus.textContent = "Validando archivo...";
    uploadBtn.disabled = true;

    validationWorker.onmessage = async (message) => {
      const { valid, errors } = message.data;
      if (!valid) {
        uploadStatus.classList.add("form-hint--error");
        uploadStatus.textContent = errors.join(" ");
        uploadBtn.disabled = false;
        return;
      }

      uploadStatus.textContent = "Subiendo y encolando para análisis con IA...";
      const formData = new FormData();
      formData.append("file", file);
      formData.append("clientId", clientId);
      formData.append("docType", uploadForm.docType.value);

      try {
        await documentsApi.upload(formData);
        showToast("Documento subido. El análisis con IA corre en segundo plano.", "success");
        uploadStatus.textContent = "Documento subido. Su estado se actualizará automáticamente.";
        uploadForm.reset();
        await loadDocuments();
      } catch (err) {
        showToast(err.message, "error");
        uploadStatus.classList.add("form-hint--error");
        uploadStatus.textContent = err.message;
      } finally {
        uploadBtn.disabled = false;
      }
    };

    validationWorker.postMessage({ name: file.name, size: file.size });
  });

  return {
    load: () => Promise.all([loadDocuments(), loadConcepts()]),
    loadDocuments,
    applyEvent,
    hasPending: () => documents.some(isPending),
    /** Firma de los estados, para que el polling sepa si algo cambió. */
    statusSignature: () => documents.map((d) => `${d.id}:${d.status}`).join("|"),
    dispose: () => validationWorker.terminate(),
  };
}

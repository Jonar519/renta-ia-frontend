import { clientsApi } from "../api/clients.api.js";
import { documentsApi } from "../api/documents.api.js";
import { alertsApi } from "../api/alerts.api.js";
import { aiApi } from "../api/ai.api.js";
import { showToast } from "../components/toast.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { bindTabs } from "../components/tabs.js";
import { escapeHtml } from "../utils/escapeHtml.js";

const DOC_TYPE_LABELS = {
  income_certificate: "Certificado de ingresos",
  bank_statement: "Extracto bancario",
  deductible_invoice: "Factura deducible",
  exogenous_info: "Información exógena",
  pension_certificate: "Certificado de pensión/salud",
  other: "Otro",
};

const CONCEPT_LABELS = {
  gross_income: "Ingreso bruto",
  withholding: "Retención",
  deduction: "Deducción",
  pension_contribution: "Aporte a pensión",
  health_contribution: "Aporte a salud",
  other: "Otro",
};

const SEVERITY_LABELS = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
const SEVERITY_TONES = { low: "neutral", medium: "info", high: "warning", critical: "error" };

/**
 * Estado visible de un documento. "error" y "processed con advertencias"
 * son cosas distintas en el backend:
 *  - error: falló la extracción de texto; no se pudo analizar nada.
 *  - processed + errorMessage: se leyó el texto, pero alguna etapa de IA
 *    (conceptos o embeddings) falló; el resto sí quedó guardado.
 */
export function documentStatus(doc) {
  switch (doc.status) {
    case "uploaded":
      return { text: "Subido", tone: "neutral" };
    case "processing":
      return { text: "Procesando", tone: "info" };
    case "processed":
      return doc.errorMessage
        ? {
            text: "Procesado con advertencias",
            tone: "warning",
            // El backend antepone "Procesado con advertencias: "; el badge ya lo dice.
            detail: doc.errorMessage.replace(/^Procesado con advertencias:\s*/, ""),
          }
        : { text: "Procesado", tone: "success" };
    case "error":
      return { text: "Error al procesar", tone: "error", detail: doc.errorMessage };
    default:
      return { text: doc.status, tone: "neutral" };
  }
}

export async function renderClientDetail(root, clientId) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("dashboard")}
      <main class="main" id="main-content" tabindex="-1">
        <a href="#/" class="link link--back">Volver a clientes</a>
        <header class="main__header">
          <div>
            <h1 class="page-title" id="client-name">Cargando cliente...</h1>
            <p class="page-subtitle" id="client-meta"></p>
          </div>
        </header>

        <div class="tabs" role="tablist" aria-label="Secciones del cliente">
          <button class="tab" role="tab" id="tab-documents" aria-controls="panel-documents" aria-selected="true" type="button">Documentos</button>
          <button class="tab" role="tab" id="tab-alerts" aria-controls="panel-alerts" aria-selected="false" type="button">Alertas</button>
          <button class="tab" role="tab" id="tab-chat" aria-controls="panel-chat" aria-selected="false" type="button">Asistente IA</button>
        </div>

        <div class="tab-panel" role="tabpanel" id="panel-documents" aria-labelledby="tab-documents" tabindex="0">
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
              <thead><tr><th scope="col">Archivo</th><th scope="col">Tipo</th><th scope="col">Estado</th><th scope="col">Subido</th></tr></thead>
              <tbody><tr><td colspan="4" class="table__empty">Cargando...</td></tr></tbody>
            </table>
          </section>
        </div>

        <div class="tab-panel" role="tabpanel" id="panel-alerts" aria-labelledby="tab-alerts" tabindex="0" hidden>
          <section class="panel">
            <h2>Alertas</h2>
            <ul class="alert-list" id="alerts-list">
              <li class="table__empty">Cargando...</li>
            </ul>
          </section>
        </div>

        <div class="tab-panel" role="tabpanel" id="panel-chat" aria-labelledby="tab-chat" tabindex="0" hidden>
          <section class="panel panel--chat">
            <h2>Pregúntale a la IA sobre este cliente</h2>
            <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Conversación con el asistente de IA">
              <p class="chat-empty">Hazle una pregunta sobre los documentos de este cliente. Por ejemplo: "¿Cuál fue el ingreso bruto reportado?"</p>
            </div>
            <form id="chat-form" class="chat-form">
              <label for="chat-question" class="visually-hidden">Tu pregunta sobre este cliente</label>
              <input type="text" id="chat-question" name="question" placeholder="Escribe tu pregunta..." required minlength="3" maxlength="1000" />
              <button type="submit" class="btn btn--primary">Preguntar</button>
            </form>
          </section>
        </div>
      </main>
    </div>
  `;

  bindSidebarEvents(root);
  bindTabs(root);

  async function loadClient() {
    try {
      const client = await clientsApi.getById(clientId);
      // Se actualiza el texto del <h1> existente (no se reemplaza el nodo)
      // para no perder el foco que el router le dio al cambiar de ruta.
      root.querySelector("#client-name").textContent = client.fullName;
      root.querySelector("#client-meta").textContent = client.email
        ? `${client.documentNumber} · ${client.email}`
        : client.documentNumber;
    } catch (err) {
      root.querySelector("#client-name").textContent = "Cliente no disponible";
      showToast(err.message, "error");
    }
  }

  async function loadDocumentsAndConcepts() {
    // Dos cargas independientes: si una falla, la otra tabla se sigue mostrando.
    await Promise.all([loadDocuments(), loadConcepts()]);
  }

  async function loadDocuments() {
    const docsTbody = root.querySelector("#documents-table tbody");

    try {
      const documents = await documentsApi.listByClient(clientId);

      if (documents.length === 0) {
        docsTbody.innerHTML = `<tr><td colspan="4" class="table__empty">Todavía no se han subido documentos.</td></tr>`;
      } else {
        docsTbody.innerHTML = documents
          .map((d) => {
            const status = documentStatus(d);
            return `
            <tr>
              <td class="table__primary">${escapeHtml(d.originalName)}</td>
              <td>${DOC_TYPE_LABELS[d.docType] || escapeHtml(d.docType)}</td>
              <td>
                <span class="badge badge--${status.tone}">${escapeHtml(status.text)}</span>
                ${status.detail ? `<p class="table__note">${escapeHtml(status.detail)}</p>` : ""}
              </td>
              <td>${new Date(d.uploadedAt).toLocaleString("es-CO")}</td>
            </tr>`;
          })
          .join("");
      }
    } catch (err) {
      docsTbody.innerHTML = `<tr><td colspan="4" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function loadConcepts() {
    const conceptsTbody = root.querySelector("#concepts-table tbody");

    try {
      // Los conceptos tributarios se consultan en una sola llamada dedicada
      // (GET /api/clients/:id/tax-concepts), en vez de pedir el detalle de
      // cada documento uno por uno.
      const allConcepts = await clientsApi.getTaxConcepts(clientId);

      if (allConcepts.length === 0) {
        conceptsTbody.innerHTML = `<tr><td colspan="4" class="table__empty">Aún no hay conceptos extraídos por la IA.</td></tr>`;
      } else {
        conceptsTbody.innerHTML = allConcepts
          .map(
            (c) => `
          <tr>
            <td class="table__primary">${CONCEPT_LABELS[c.conceptType] || escapeHtml(c.conceptType)}</td>
            <td>${escapeHtml(c.description || "—")}</td>
            <td>$${Number(c.amount).toLocaleString("es-CO")}</td>
            <td>${escapeHtml(String(c.periodYear))}</td>
          </tr>`
          )
          .join("");
      }
    } catch (err) {
      conceptsTbody.innerHTML = `<tr><td colspan="4" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  async function loadAlerts() {
    const list = root.querySelector("#alerts-list");
    try {
      const alerts = await alertsApi.listByClient(clientId);

      if (alerts.length === 0) {
        list.innerHTML = `<li class="table__empty">No hay alertas para este cliente.</li>`;
        return;
      }

      list.innerHTML = alerts
        .map(
          (a) => `
        <li class="alert-item">
          <span class="badge badge--${SEVERITY_TONES[a.severity] || "neutral"}">${SEVERITY_LABELS[a.severity] || escapeHtml(a.severity)}</span>
          <div>
            <p>${escapeHtml(a.message)}</p>
            <p class="alert-item__meta">${new Date(a.createdAt).toLocaleString("es-CO")}${
              a.dueDate ? " · vence " + new Date(a.dueDate).toLocaleDateString("es-CO") : ""
            }</p>
          </div>
        </li>`
        )
        .join("");
    } catch (err) {
      list.innerHTML = `<li class="table__empty table__empty--error">${escapeHtml(err.message)}</li>`;
    }
  }

  // Todas las cargas iniciales en paralelo; los formularios se conectan de
  // inmediato, sin esperar a que terminen.
  const initialLoad = Promise.all([loadClient(), loadDocumentsAndConcepts(), loadAlerts()]);

  // --- Subida de documentos, validada primero en un Web Worker ---
  const uploadForm = root.querySelector("#upload-form");
  const uploadStatus = root.querySelector("#upload-status");
  const uploadBtn = root.querySelector("#upload-btn");

  const validationWorker = new Worker(new URL("../workers/fileValidation.worker.js", import.meta.url), {
    type: "module",
  });

  uploadForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const fileInput = uploadForm.querySelector('input[type="file"]');
    const file = fileInput.files[0];
    if (!file) return;

    uploadStatus.classList.remove("form-hint--error");
    uploadStatus.textContent = "Validando archivo...";
    uploadBtn.disabled = true;

    validationWorker.onmessage = async (event) => {
      const { valid, errors } = event.data;

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
        uploadStatus.textContent = "Documento subido. El análisis con IA corre en segundo plano.";
        uploadForm.reset();
        await loadDocumentsAndConcepts();
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

  // --- Chat con IA (RAG) ---
  const chatForm = root.querySelector("#chat-form");
  const chatLog = root.querySelector("#chat-log");

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = chatForm.question;
    const question = input.value.trim();
    if (!question) return;

    appendChatMessage(chatLog, "user", question);
    input.value = "";
    input.disabled = true;

    const pendingEl = appendChatMessage(chatLog, "assistant", "Pensando...", true);

    try {
      const result = await aiApi.chat(clientId, question);
      pendingEl.querySelector(".chat-bubble").textContent = result.answer;
      pendingEl.classList.remove("chat-message--pending");
    } catch (err) {
      pendingEl.querySelector(".chat-bubble").textContent = `No se pudo responder: ${err.message}`;
      pendingEl.classList.remove("chat-message--pending");
      pendingEl.classList.add("chat-message--error");
    } finally {
      input.disabled = false;
      input.focus();
    }
  });

  await initialLoad;
}

function appendChatMessage(logEl, role, text, pending = false) {
  const empty = logEl.querySelector(".chat-empty");
  if (empty) empty.remove();

  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-message--${role}${pending ? " chat-message--pending" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  logEl.appendChild(wrapper);
  logEl.scrollTop = logEl.scrollHeight;
  return wrapper;
}

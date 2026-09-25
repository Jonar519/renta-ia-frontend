import { clientsApi } from "../api/clients.api.js";
import { documentsApi } from "../api/documents.api.js";
import { alertsApi } from "../api/alerts.api.js";
import { aiApi } from "../api/ai.api.js";
import { showToast } from "../components/toast.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { escapeHtml } from "../utils/escapeHtml.js";

const DOC_TYPE_LABELS = {
  income_certificate: "Certificado de ingresos",
  bank_statement: "Extracto bancario",
  deductible_invoice: "Factura deducible",
  exogenous_info: "Información exógena",
  pension_certificate: "Certificado de pensión/salud",
  other: "Otro",
};

const STATUS_LABELS = {
  uploaded: { text: "Subido", tone: "neutral" },
  processing: { text: "Procesando", tone: "info" },
  processed: { text: "Procesado", tone: "success" },
  error: { text: "Con advertencias", tone: "warning" },
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

export async function renderClientDetail(root, clientId) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("dashboard")}
      <main class="main">
        <a href="#/" class="link link--back">Volver a clientes</a>
        <header class="main__header" id="client-header">
          <div><h1 class="page-title">Cargando cliente...</h1></div>
        </header>

        <div class="tabs">
          <button class="tab is-active" data-tab="documents" type="button">Documentos</button>
          <button class="tab" data-tab="alerts" type="button">Alertas</button>
          <button class="tab" data-tab="chat" type="button">Asistente IA</button>
        </div>

        <section class="tab-panel" data-panel="documents">
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
            <p id="upload-status" class="form-hint"></p>
          </section>

          <section class="panel">
            <h2>Conceptos tributarios extraídos</h2>
            <table class="table" id="concepts-table">
              <thead><tr><th>Concepto</th><th>Descripción</th><th>Monto</th><th>Año</th></tr></thead>
              <tbody><tr><td colspan="4" class="table__empty">Aún no hay conceptos extraídos.</td></tr></tbody>
            </table>
          </section>

          <section class="panel">
            <h2>Documentos</h2>
            <table class="table" id="documents-table">
              <thead><tr><th>Archivo</th><th>Tipo</th><th>Estado</th><th>Subido</th></tr></thead>
              <tbody><tr><td colspan="4" class="table__empty">Cargando...</td></tr></tbody>
            </table>
          </section>
        </section>

        <section class="tab-panel" data-panel="alerts" hidden>
          <section class="panel">
            <h2>Alertas</h2>
            <ul class="alert-list" id="alerts-list">
              <li class="table__empty">Cargando...</li>
            </ul>
          </section>
        </section>

        <section class="tab-panel" data-panel="chat" hidden>
          <section class="panel panel--chat">
            <h2>Pregúntale a la IA sobre este cliente</h2>
            <div class="chat-log" id="chat-log">
              <p class="chat-empty">Hazle una pregunta sobre los documentos de este cliente. Por ejemplo: "¿Cuál fue el ingreso bruto reportado?"</p>
            </div>
            <form id="chat-form" class="chat-form">
              <input type="text" name="question" placeholder="Escribe tu pregunta..." required />
              <button type="submit" class="btn btn--primary">Preguntar</button>
            </form>
          </section>
        </section>
      </main>
    </div>
  `;

  bindSidebarEvents(root);
  bindTabs(root);

  try {
    const client = await clientsApi.getById(clientId);
    root.querySelector("#client-header").innerHTML = `
      <div>
        <h1 class="page-title">${escapeHtml(client.fullName)}</h1>
        <p class="page-subtitle">${escapeHtml(client.documentNumber)}${client.email ? " · " + escapeHtml(client.email) : ""}</p>
      </div>
    `;
  } catch (err) {
    showToast(err.message, "error");
  }

  async function loadDocumentsAndConcepts() {
    const docsTbody = root.querySelector("#documents-table tbody");
    const conceptsTbody = root.querySelector("#concepts-table tbody");

    try {
      const documents = await documentsApi.listByClient(clientId);

      if (documents.length === 0) {
        docsTbody.innerHTML = `<tr><td colspan="4" class="table__empty">Todavía no se han subido documentos.</td></tr>`;
      } else {
        docsTbody.innerHTML = documents
          .map((d) => {
            const status = STATUS_LABELS[d.status] || { text: d.status, tone: "neutral" };
            return `
            <tr>
              <td class="table__primary">${escapeHtml(d.originalName)}</td>
              <td>${DOC_TYPE_LABELS[d.docType] || d.docType}</td>
              <td><span class="badge badge--${status.tone}">${status.text}</span></td>
              <td>${new Date(d.uploadedAt).toLocaleString("es-CO")}</td>
            </tr>`;
          })
          .join("");
      }

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
            <td class="table__primary">${CONCEPT_LABELS[c.conceptType] || c.conceptType}</td>
            <td>${escapeHtml(c.description || "—")}</td>
            <td>$${Number(c.amount).toLocaleString("es-CO")}</td>
            <td>${c.periodYear}</td>
          </tr>`
          )
          .join("");
      }
    } catch (err) {
      docsTbody.innerHTML = `<tr><td colspan="4" class="table__empty table__empty--error">${escapeHtml(err.message)}</td></tr>`;
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
          <span class="badge badge--${SEVERITY_TONES[a.severity] || "neutral"}">${SEVERITY_LABELS[a.severity] || a.severity}</span>
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

  await loadDocumentsAndConcepts();
  await loadAlerts();

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
        uploadStatus.textContent = "";
        uploadForm.reset();
        await loadDocumentsAndConcepts();
      } catch (err) {
        showToast(err.message, "error");
        uploadStatus.textContent = "";
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

function bindTabs(root) {
  const tabs = root.querySelectorAll(".tab");
  const panels = root.querySelectorAll(".tab-panel");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      panels.forEach((panel) => {
        panel.hidden = panel.dataset.panel !== tab.dataset.tab;
      });
    });
  });
}

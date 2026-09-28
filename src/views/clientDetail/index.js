import { clientsApi } from "../../api/clients.api.js";
import { showErrorToast } from "../../components/toast.js";
import { renderSidebar, bindSidebarEvents } from "../../components/sidebar.js";
import { bindTabs } from "../../components/tabs.js";
import { registerCleanup } from "../../router.js";
import { getRealtimeStatus, onDocumentUpdate, onRealtimeStatus } from "../../realtime/realtime.js";
import { createPoller } from "../../realtime/poller.js";
import { createDocumentsSection, documentsPanelHtml } from "./documents.section.js";
import { alertsPanelHtml, createAlertsSection } from "./alerts.section.js";
import { createSummarySection, summaryPanelHtml } from "./summary.section.js";
import { chatPanelHtml, createChatSection } from "./chat.section.js";

export { documentStatus } from "./labels.js";

const TABS = [
  ["documents", "Documentos", documentsPanelHtml],
  ["alerts", "Alertas", alertsPanelHtml],
  ["summary", "Resumen", summaryPanelHtml],
  ["chat", "Asistente IA", chatPanelHtml],
];

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
          <p class="live-status" id="live-status" role="status" aria-live="polite"></p>
        </header>

        <div class="tabs" role="tablist" aria-label="Secciones del cliente">
          ${TABS.map(
            ([id, label], i) =>
              `<button class="tab" role="tab" id="tab-${id}" aria-controls="panel-${id}" aria-selected="${i === 0}" type="button">${label}</button>`
          ).join("")}
        </div>

        ${TABS.map(
          ([id, , html], i) =>
            `<div class="tab-panel" role="tabpanel" id="panel-${id}" aria-labelledby="tab-${id}" tabindex="0"${i === 0 ? "" : " hidden"}>${html()}</div>`
        ).join("")}
      </main>
    </div>
  `;

  bindSidebarEvents(root);
  bindTabs(root);

  // Se aborta al salir de la vista: cancela la huella SHA-256 o la
  // agregación en curso y termina los Web Workers de esta vista.
  const viewAbort = new AbortController();

  const alerts = createAlertsSection(root, clientId);
  // Cuando un documento termina, las reglas pueden haber creado alertas nuevas.
  const documents = createDocumentsSection(root, clientId, {
    signal: viewAbort.signal,
    onProcessed: () => alerts.load(),
  });
  createSummarySection(root, clientId);
  createChatSection(root, clientId);

  // --- Estado en tiempo real: WebSocket, con polling de respaldo ---
  const liveStatus = root.querySelector("#live-status");

  const poller = createPoller({
    async poll() {
      const before = documents.statusSignature();
      await documents.loadDocuments();
      const changed = documents.statusSignature() !== before;
      if (changed) alerts.load();
      return { pending: documents.hasPending(), changed };
    },
    onSchedule: (ms) => {
      liveStatus.textContent = `Sin conexión en tiempo real · revisando cada ${Math.round(ms / 1000)} s`;
    },
  });

  function syncLiveMode() {
    if (getRealtimeStatus() === "open") {
      poller.stop();
      liveStatus.textContent = "● Actualización en tiempo real";
    } else if (documents.hasPending()) {
      poller.start();
    } else {
      poller.stop();
      liveStatus.textContent = "";
    }
  }

  const offUpdate = onDocumentUpdate((event) => {
    if (event.clientId !== clientId) return;
    documents.applyEvent(event);
    if (event.status === "error") alerts.load();
  });
  let wasOpen = getRealtimeStatus() === "open";
  const offStatus = onRealtimeStatus((status) => {
    // Al reconectar se recarga una vez: Redis pub/sub no guarda los eventos
    // que ocurrieron mientras el socket estuvo caído.
    if (status === "open" && !wasOpen) documents.loadDocuments();
    wasOpen = status === "open";
    syncLiveMode();
  });

  registerCleanup(() => {
    offUpdate();
    offStatus();
    poller.stop();
    viewAbort.abort();
  });

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
      showErrorToast(err);
    }
  }

  // Todas las cargas iniciales en paralelo.
  await Promise.all([loadClient(), documents.load(), alerts.load()]);
  syncLiveMode();
}

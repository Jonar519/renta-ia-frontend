import { formatAge, getConnectivity, onConnectivityChange } from "../offline/connectivity.js";
import { showToast } from "./toast.js";

export const LOST_MESSAGE = "Se perdió la conexión a internet. Puedes seguir consultando los datos guardados.";
export const RESTORED_MESSAGE = "Conexión restablecida.";

// Controles que necesitan red (los mismos que bloquea blockIfOffline).
const NETWORK_CONTROLS = 'button[data-requires-network], [data-requires-network] button[type="submit"]';

/**
 * Sin conexión, esos controles quedan marcados aria-disabled: el lector de
 * pantalla los anuncia como no disponibles y, como son controles inactivos,
 * su atenuación visual (opacity) no incumple el contraste (WCAG 1.4.3).
 */
function markNetworkControls(offline) {
  for (const control of document.querySelectorAll(NETWORK_CONTROLS)) {
    if (offline) control.setAttribute("aria-disabled", "true");
    else control.removeAttribute("aria-disabled");
  }
}

export const OFFLINE_WRITE_MESSAGE =
  "Sin conexión: esta acción necesita internet. No se guardó ni se encoló ningún cambio.";

/**
 * Indicador "Sin conexión · datos de hace X" y bloqueo de escrituras.
 *
 * Sin conexión, todo lo marcado con data-requires-network (subir documentos,
 * crear clientes, chat, resumen, reintentos, cambiar alertas) queda
 * deshabilitado: se intercepta en fase de captura, antes que el handler de
 * la vista, y se explica por qué. Las escrituras NO se encolan para después.
 */
export function startConnectivityBanner() {
  const banner = document.createElement("div");
  banner.className = "connectivity-banner";
  banner.setAttribute("role", "status");
  banner.hidden = true;
  document.body.prepend(banner);

  // Toast SOLO en la transición (se perdió / se recuperó), no al cargar la
  // página. El banner, en cambio, se queda mientras dure la desconexión.
  let wasOnline = getConnectivity().online;
  function announceTransition({ online }) {
    if (online === wasOnline) return;
    wasOnline = online;
    showToast(online ? RESTORED_MESSAGE : LOST_MESSAGE, online ? "success" : "warning");
  }

  // Mientras dure la desconexión, también los controles que se pinten después.
  const observer = new MutationObserver(() => markNetworkControls(true));

  function render({ online, staleSince }) {
    document.body.classList.toggle("is-offline", !online);
    markNetworkControls(!online);
    if (online) observer.disconnect();
    else observer.observe(document.body, { childList: true, subtree: true });
    banner.hidden = online;
    if (online) return;
    banner.textContent = staleSince
      ? `Sin conexión · Mostrando datos guardados ${formatAge(staleSince)}. Solo lectura: no se pueden subir documentos ni hacer cambios.`
      : "Sin conexión · Solo lectura: no se pueden subir documentos ni hacer cambios.";
  }

  function blockIfOffline(event) {
    if (getConnectivity().online) return;
    const target = event.target.closest?.("[data-requires-network]");
    if (!target) return;
    // Un submit se bloquea en el formulario; un clic, en el botón.
    if (event.type === "click" && target.tagName === "FORM") return;
    event.preventDefault();
    event.stopImmediatePropagation();
    banner.textContent = OFFLINE_WRITE_MESSAGE;
  }

  document.addEventListener("submit", blockIfOffline, true);
  document.addEventListener("click", blockIfOffline, true);
  onConnectivityChange(render);
  onConnectivityChange(announceTransition);
  render(getConnectivity());
}

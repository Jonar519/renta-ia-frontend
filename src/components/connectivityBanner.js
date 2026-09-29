import { formatAge, getConnectivity, onConnectivityChange } from "../offline/connectivity.js";

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

  function render({ online, staleSince }) {
    document.body.classList.toggle("is-offline", !online);
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
  render(getConnectivity());
}

import { ROLE_LABELS } from "../auth/roles.js";

/** Texto del aviso según la decisión del guard (auth/routeAccess.js). */
export function noticeText({ reason, label = "esa página", role } = {}) {
  if (reason === "missing") return "La página que buscabas no existe. Te llevamos a Clientes.";
  if (reason === "login") return "Inicia sesión para continuar.";
  const who = ROLE_LABELS[role] ? ` Tu rol (${ROLE_LABELS[role]}) no tiene acceso.` : "";
  return `No tienes permiso para ver "${label}".${who} Te llevamos a Clientes.`;
}

/**
 * Aviso que explica un rebote del guard de rutas ("No tienes permiso para
 * ver Rendimiento…"). Va DENTRO del contenido de la vista de destino, arriba,
 * en el flujo normal: no es flotante, no tapa nada y se cierra con su botón.
 * role="alert" hace que el lector de pantalla lo anuncie al aparecer.
 */
export function showRouteNotice(notice) {
  const host = document.getElementById("main-content") ?? document.getElementById("app");
  if (!host) return;
  host.querySelector(".route-notice")?.remove();

  const box = document.createElement("div");
  box.className = "route-notice";
  box.setAttribute("role", "alert");
  const text = document.createElement("p");
  text.textContent = noticeText(notice);
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--ghost btn--small";
  close.textContent = "Entendido";
  close.addEventListener("click", () => {
    box.remove();
    host.querySelector("h1")?.focus();
  });
  box.append(text, close);
  host.prepend(box);
}

/**
 * Aviso que explica un rebote del guard de rutas ("No tienes permiso para
 * ver Rendimiento…"). Va DENTRO del contenido de la vista de destino, arriba,
 * en el flujo normal: no es flotante, no tapa nada y se cierra con su botón.
 * role="alert" hace que el lector de pantalla lo anuncie al aparecer.
 */
export function showRouteNotice(message) {
  const host = document.getElementById("main-content") ?? document.getElementById("app");
  if (!host) return;
  host.querySelector(".route-notice")?.remove();

  const notice = document.createElement("div");
  notice.className = "route-notice";
  notice.setAttribute("role", "alert");
  const text = document.createElement("p");
  text.textContent = message;
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn btn--ghost btn--small";
  close.textContent = "Entendido";
  close.addEventListener("click", () => {
    notice.remove();
    host.querySelector("h1")?.focus();
  });
  notice.append(text, close);
  host.prepend(notice);
}

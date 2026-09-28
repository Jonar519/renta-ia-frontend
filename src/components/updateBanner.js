let banner = null;

/**
 * Aviso persistente (no un toast que desaparece) de que hay una versión
 * nueva de la app. No recarga solo: el usuario podría estar escribiendo.
 */
export function showUpdateBanner(onReload) {
  if (banner) return;
  banner = document.createElement("div");
  banner.className = "update-banner";
  banner.setAttribute("role", "status");
  banner.innerHTML = `
    <span>Hay una versión nueva de Renta IA.</span>
    <button type="button" class="btn btn--primary btn--small" data-action="reload">Recargar</button>
    <button type="button" class="btn btn--ghost btn--small" data-action="dismiss">Más tarde</button>
  `;
  banner.addEventListener("click", (event) => {
    const action = event.target.closest("button")?.dataset.action;
    if (action === "reload") onReload();
    if (action === "dismiss") {
      banner.remove();
      banner = null;
    }
  });
  document.body.appendChild(banner);
}

import { showUpdateBanner } from "../components/updateBanner.js";

const UPDATE_CHECK_MS = 30 * 60 * 1000;

/** Activa el SW que está esperando y recarga cuando toma el control. */
function activateWaiting(worker) {
  navigator.serviceWorker.addEventListener("controllerchange", () => window.location.reload(), { once: true });
  worker.postMessage({ type: "SKIP_WAITING" });
}

/**
 * Registra el Service Worker solo en el build de producción.
 *
 * En desarrollo NO hay Service Worker (y se desregistra si quedó uno): con
 * Vite sirviendo archivos que cambian a cada rato, un SW cacheando el shell
 * mostraba un index.html viejo (pasó durante el desarrollo de este proyecto).
 *
 * Aviso de versión nueva: cuando un despliegue cambia el SW (nuevo build),
 * el nuevo queda "esperando" y se muestra "Hay una versión nueva · Recargar".
 * También si el SW detecta que el shell cambió (stale-while-revalidate).
 */
export function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  if (!import.meta.env.PROD) {
    navigator.serviceWorker.getRegistrations().then((registrations) => registrations.forEach((r) => r.unregister()));
    return;
  }

  window.addEventListener("load", async () => {
    let registration;
    try {
      registration = await navigator.serviceWorker.register("/service-worker.js");
    } catch (err) {
      console.error("No se pudo registrar el Service Worker:", err);
      return;
    }

    const offerUpdate = (worker) => showUpdateBanner(() => activateWaiting(worker));

    // Había una versión nueva esperando de una visita anterior.
    if (registration.waiting && navigator.serviceWorker.controller) offerUpdate(registration.waiting);

    registration.addEventListener("updatefound", () => {
      const installing = registration.installing;
      installing?.addEventListener("statechange", () => {
        // "installed" con un controller existente = actualización (no primera instalación).
        if (installing.state === "installed" && navigator.serviceWorker.controller) offerUpdate(installing);
      });
    });

    navigator.serviceWorker.addEventListener("message", (event) => {
      if (event.data?.type === "SHELL_UPDATED") {
        showUpdateBanner(() =>
          registration.waiting ? activateWaiting(registration.waiting) : window.location.reload()
        );
      }
    });

    // Una pestaña abierta todo el día también debe enterarse de un despliegue.
    setInterval(() => registration.update().catch(() => {}), UPDATE_CHECK_MS);
  });
}

const routes = [];

export function registerRoute(pattern, handler) {
  routes.push({ pattern, parts: pattern.split("/").filter(Boolean), handler });
}

export function navigate(path) {
  window.location.hash = path;
}

/**
 * Tras cambiar de vista, mueve el foco al <h1> de la vista nueva. Así un
 * lector de pantalla anuncia la página nueva y el teclado no queda "perdido"
 * en un elemento que ya no existe.
 */
function focusMainHeading() {
  const heading = document.querySelector("#app h1");
  if (!heading) return;
  heading.setAttribute("tabindex", "-1");
  heading.focus();
}

// Funciones de limpieza de la vista actual (suscripciones al WebSocket,
// timers de polling, peticiones en curso...). Se ejecutan al cambiar de ruta.
let cleanups = [];

/** Registra una limpieza para cuando el usuario salga de la vista actual. */
export function registerCleanup(fn) {
  cleanups.push(fn);
}

// Se aborta al salir de la vista: http.js lo usa para cancelar las peticiones
// GET en vuelo de la vista anterior (ya nadie va a mostrar su resultado).
let routeController = new AbortController();

/** Señal de la vista actual: se aborta en cuanto el usuario navega a otra. */
export function getRouteSignal() {
  return routeController.signal;
}

function runCleanups() {
  routeController.abort();
  routeController = new AbortController();
  const pending = cleanups;
  cleanups = [];
  for (const fn of pending) {
    try {
      fn();
    } catch (err) {
      console.error("Error al limpiar la vista anterior:", err);
    }
  }
}

// Cada navegación tiene un número; si mientras se descarga el código de una
// vista el usuario navega a otra, la anterior queda "obsoleta" y no se pinta.
let navigationId = 0;
let currentPattern = "/login";

/**
 * Patrón de la ruta actual ("/clients/:id"), nunca la URL real: es lo que se
 * reporta con las métricas de rendimiento, sin ids de clientes.
 */
export function currentRoutePattern() {
  return currentPattern;
}

async function resolve({ initial = false } = {}) {
  runCleanups();
  const currentNavigation = ++navigationId;
  const context = { isStale: () => currentNavigation !== navigationId };
  const hash = window.location.hash.slice(1) || "/login";
  const hashParts = hash.split("/").filter(Boolean);

  for (const route of routes) {
    if (route.parts.length !== hashParts.length) continue;

    const params = {};
    let matched = true;

    for (let i = 0; i < route.parts.length; i++) {
      const routePart = route.parts[i];
      if (routePart.startsWith(":")) {
        params[routePart.slice(1)] = decodeURIComponent(hashParts[i]);
      } else if (routePart !== hashParts[i]) {
        matched = false;
        break;
      }
    }

    if (matched) {
      currentPattern = route.pattern;
      // El handler resuelve cuando la vista ya pintó su estructura (con el
      // <h1>): las vistas se cargan con import() dinámico (code-splitting).
      await route.handler(params, context);
      // En la carga inicial de la página no se roba el foco.
      if (!initial && !context.isStale()) focusMainHeading();
      return;
    }
  }

  // Ninguna ruta coincidió: volver al login.
  navigate("/login");
}

export function startRouter() {
  window.addEventListener("hashchange", () => resolve());
  resolve({ initial: true });
}

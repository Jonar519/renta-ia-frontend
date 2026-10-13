const routes = [];

/**
 * @param {string} pattern  "/clients/:id"
 * @param {(params, context) => Promise<void>} handler
 * @param {object} [meta]   datos para el guard: { auth, roles, label }
 */
export function registerRoute(pattern, handler, meta = {}) {
  routes.push({ pattern, parts: pattern.split("/").filter(Boolean), handler, meta });
}

export function navigate(path) {
  window.location.hash = path;
}

/**
 * Guard de rutas (main.js lo configura con la sesión y el rol). Se ejecuta
 * ANTES de descargar el código de la vista: una vista prohibida ni se pide.
 * Devuelve null si se puede entrar, o { redirect, notice } para rebotar.
 * Es solo experiencia de usuario: la autorización real la hace la API.
 *
 * @type {(route: { pattern: string, meta: object } | null) => ({ redirect: string, notice?: string } | null)}
 */
let guard = () => null;
export function setRouteGuard(fn) {
  guard = fn;
}

// Aviso para la vista de destino de un rebote ("No tienes permiso…").
let pendingNotice = null;
let showNotice = () => {};
/** Cómo se muestra el aviso tras pintar la vista (components/routeNotice.js). */
export function setNoticeRenderer(fn) {
  showNotice = fn;
}

function bounce({ redirect, notice }) {
  pendingNotice = notice ?? null;
  // replace: el historial no conserva la ruta prohibida ("Atrás" no vuelve a ella).
  window.location.replace(`#${redirect}`);
}

function matchRoute(hash) {
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
    if (matched) return { route, params };
  }
  return null;
}

const currentHash = () => window.location.hash.slice(1) || "/login";

/**
 * Vuelve a pasar la ruta actual por el guard (p. ej. cuando llega el usuario
 * real tras recuperar la sesión: la pista de localStorage pudo traer otro
 * rol). Si ya no se puede estar ahí, rebota; si sí, no vuelve a pintar.
 */
export function recheckRoute() {
  const match = matchRoute(currentHash());
  const decision = guard(match ? match.route : null);
  if (decision) bounce(decision);
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
  const match = matchRoute(currentHash());
  const decision = guard(match ? match.route : null);
  if (decision) {
    bounce(decision);
    return;
  }
  if (!match) {
    // Sin guard que decida (no debería pasar): volver al login.
    navigate("/login");
    return;
  }

  const { route, params } = match;
  currentPattern = route.pattern;
  // El handler resuelve cuando la vista ya pintó su estructura (con el
  // <h1>): las vistas se cargan con import() dinámico (code-splitting).
  await route.handler(params, context);
  if (context.isStale()) return;
  if (pendingNotice) {
    showNotice(pendingNotice);
    pendingNotice = null;
  }
  // En la carga inicial de la página no se roba el foco.
  if (!initial) focusMainHeading();
}

/** Arranca el router. Devuelve la función que lo detiene (tests). */
export function startRouter() {
  const onHashChange = () => resolve();
  window.addEventListener("hashchange", onHashChange);
  resolve({ initial: true });
  return () => window.removeEventListener("hashchange", onHashChange);
}

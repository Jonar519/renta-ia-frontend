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

function runCleanups() {
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

function resolve({ initial = false } = {}) {
  runCleanups();
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
      // Las vistas pintan su HTML (con el <h1>) de forma síncrona antes de
      // su primer await, así que el <h1> ya existe al volver del handler.
      route.handler(params);
      // En la carga inicial de la página no se roba el foco.
      if (!initial) focusMainHeading();
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

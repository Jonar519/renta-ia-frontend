const routes = [];

export function registerRoute(pattern, handler) {
  routes.push({ pattern, parts: pattern.split("/").filter(Boolean), handler });
}

export function navigate(path) {
  window.location.hash = path;
}

function resolve() {
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
      route.handler(params);
      return;
    }
  }

  // Ninguna ruta coincidió: volver al login.
  navigate("/login");
}

export function startRouter() {
  window.addEventListener("hashchange", resolve);
  resolve();
}

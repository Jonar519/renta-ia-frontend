import { afterEach, describe, expect, it, vi } from "vitest";
import { decideRoute, ROLE_LABELS } from "../src/auth/routeAccess.js";

/**
 * Guard de rutas por rol: un usuario sin permiso que escribe la URL rebota a
 * una pantalla permitida con un aviso, y la vista prohibida NI SE DESCARGA.
 * (En Chrome real: e2e/guard.spec.js.)
 */

const route = (meta) => ({ pattern: "/x", meta });
const ADMIN_ONLY = route({ auth: true, roles: ["admin"], label: "Rendimiento" });

describe("decideRoute", () => {
  it("deja entrar al rol permitido y a rutas sin restricción de rol", () => {
    expect(decideRoute(ADMIN_ONLY, { hasSession: true, role: "admin" })).toBeNull();
    expect(decideRoute(route({ auth: true }), { hasSession: true, role: "assistant" })).toBeNull();
    expect(decideRoute(route({ auth: false }), { hasSession: false })).toBeNull();
  });

  it("rebota a Clientes con un aviso que nombra la página y el rol", () => {
    for (const role of ["assistant", "accountant", "client"]) {
      const decision = decideRoute(ADMIN_ONLY, { hasSession: true, role });
      expect(decision.redirect).toBe("/");
      expect(decision.notice).toContain('No tienes permiso para ver "Rendimiento".');
      expect(decision.notice).toContain(ROLE_LABELS[role]);
    }
  });

  it("sin rol conocido (pista manipulada o incompleta) tampoco entra", () => {
    expect(decideRoute(ADMIN_ONLY, { hasSession: true, role: undefined })?.redirect).toBe("/");
    expect(decideRoute(ADMIN_ONLY, { hasSession: true, role: "superadmin" })?.redirect).toBe("/");
  });

  it("sin sesión → login; ruta inexistente → Clientes (con sesión) o login (sin sesión)", () => {
    expect(decideRoute(ADMIN_ONLY, { hasSession: false })).toEqual({
      redirect: "/login",
      notice: "Inicia sesión para continuar.",
    });
    expect(decideRoute(null, { hasSession: true }).redirect).toBe("/");
    expect(decideRoute(null, { hasSession: true }).notice).toContain("no existe");
    expect(decideRoute(null, { hasSession: false })).toEqual({ redirect: "/login" });
  });
});

describe("router + guard (jsdom)", () => {
  let stop = () => {};
  afterEach(() => {
    stop();
    document.body.innerHTML = "";
    window.location.hash = "";
  });

  async function setup(session) {
    vi.resetModules();
    const router = await import("../src/router.js");
    const { showRouteNotice } = await import("../src/components/routeNotice.js");
    document.body.innerHTML = `<div id="app"></div>`;
    const app = document.getElementById("app");
    const view = (title) =>
      vi.fn(async () => {
        app.innerHTML = `<main id="main-content"><h1>${title}</h1></main>`;
      });
    const views = { home: view("Clientes"), perf: view("Rendimiento"), login: view("Login") };
    router.registerRoute("/", views.home, { auth: true, label: "Clientes" });
    router.registerRoute("/performance", views.perf, { auth: true, roles: ["admin"], label: "Rendimiento" });
    router.registerRoute("/login", views.login, { auth: false });
    router.setRouteGuard((r) => decideRoute(r, session));
    router.setNoticeRenderer(showRouteNotice);
    return { router, views };
  }

  // hashchange es asíncrono: se espera a que pase ANTES de arrancar el router,
  // como en la app real (que arranca antes de cualquier navegación).
  const goTo = async (hash) => {
    window.location.hash = hash;
    await settle();
  };

  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

  it("un asistente que escribe #/performance rebota a Clientes con aviso, sin ejecutar la vista", async () => {
    const session = { hasSession: true, role: "assistant" };
    const { router, views } = await setup(session);
    await goTo("/performance");
    stop = router.startRouter();
    await settle();
    expect(window.location.hash).toBe("#/");
    expect(views.perf).not.toHaveBeenCalled();
    expect(views.home).toHaveBeenCalled();
    const notice = document.querySelector('.route-notice[role="alert"]');
    expect(notice.textContent).toContain('No tienes permiso para ver "Rendimiento".');
    expect(document.querySelector("#main-content").firstElementChild).toBe(notice);
  });

  it("el aviso se cierra con su botón y el foco vuelve al título", async () => {
    const { router } = await setup({ hasSession: true, role: "assistant" });
    await goTo("/performance");
    stop = router.startRouter();
    await settle();
    document.querySelector(".route-notice button").click();
    expect(document.querySelector(".route-notice")).toBeNull();
    expect(document.activeElement.tagName).toBe("H1");
  });

  it("el admin entra a #/performance", async () => {
    const { router, views } = await setup({ hasSession: true, role: "admin" });
    await goTo("/performance");
    stop = router.startRouter();
    await settle();
    expect(window.location.hash).toBe("#/performance");
    expect(views.perf).toHaveBeenCalled();
    expect(document.querySelector(".route-notice")).toBeNull();
  });

  it("recheckRoute: si llega el rol real y no es admin, sale de la vista prohibida", async () => {
    const session = { hasSession: true, role: "admin" }; // pista de localStorage desactualizada
    const { router, views } = await setup(session);
    await goTo("/performance");
    stop = router.startRouter();
    await settle();
    expect(views.perf).toHaveBeenCalledTimes(1);

    session.role = "assistant"; // /refresh devolvió el usuario real
    router.recheckRoute();
    await settle();
    expect(window.location.hash).toBe("#/");
    expect(document.querySelector(".route-notice").textContent).toContain("Asistente");
  });

  it("una ruta inexistente con sesión lleva a Clientes con aviso", async () => {
    const { router } = await setup({ hasSession: true, role: "accountant" });
    await goTo("/no-existe");
    stop = router.startRouter();
    await settle();
    expect(window.location.hash).toBe("#/");
    expect(document.querySelector(".route-notice").textContent).toContain("no existe");
  });
});

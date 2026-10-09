import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Sesiones activas" en Seguridad (B13): lo desconocido se muestra como
 * "desconocida", la ubicación se rotula como aproximada, cerrar una o todas
 * las demás (con confirmación). En Chrome real: e2e/sessions.spec.js.
 */

vi.mock("../src/api/mfa.api.js", () => ({
  mfaApi: { status: vi.fn(), setup: vi.fn(), enable: vi.fn(), disable: vi.fn(), regenerateCodes: vi.fn() },
}));
vi.mock("../src/api/users.api.js", () => ({
  usersApi: { sessions: vi.fn(), closeSession: vi.fn(), closeOtherSessions: vi.fn() },
}));

const { mfaApi } = await import("../src/api/mfa.api.js");
const { usersApi } = await import("../src/api/users.api.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { renderSecurity } = await import("../src/views/security.view.js");

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const app = () => document.getElementById("app");
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);

const CURRENT = {
  id: "11111111-1111-4111-8111-111111111111",
  current: true,
  createdAt: "2026-10-09T14:00:00.000Z",
  lastSeenAt: "2026-10-09T15:30:00.000Z",
  ip: "181.49.12.x",
  location: "Bogotá, Colombia",
  device: "Chrome en Windows",
};
const PHONE = {
  ...CURRENT,
  id: "22222222-2222-4222-8222-222222222222",
  current: false,
  ip: "2800:e2::/48",
  device: "Safari en iOS",
};
// Anterior a B13: sin IP, ubicación ni equipo.
const OLD = {
  ...CURRENT,
  id: "33333333-3333-4333-8333-333333333333",
  current: false,
  ip: null,
  location: null,
  device: null,
};

async function render(sessions = [CURRENT, PHONE, OLD], user = { role: "accountant", mfaEnabled: false }) {
  setAuth("token", { id: "u1", name: "Ana", email: "ana@example.com", ...user });
  mfaApi.status.mockResolvedValue({ enabled: false, required: false });
  usersApi.sessions.mockResolvedValue(sessions);
  await renderSecurity(app());
  await flush();
}
const items = () => [...app().querySelectorAll(".session")];
const field = (item, label) =>
  [...item.querySelectorAll(".session__meta div")]
    .find((d) => d.querySelector("dt").textContent === label)
    ?.querySelector("dd").textContent;

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  vi.clearAllMocks();
  clearAuth();
});

describe("lista", () => {
  it("muestra cada sesión con ubicación APROXIMADA, IP recortada, fechas y equipo; la actual marcada", async () => {
    await render();
    expect(app().querySelector("#sessions-title").textContent).toBe("Sesiones activas");
    const [current, phone] = items();
    expect(current.querySelector(".session__device").textContent).toContain("Chrome en Windows");
    expect(current.querySelector(".badge").textContent).toBe("Esta sesión");
    expect(current.querySelector("[data-close]")).toBeNull(); // la actual no se cierra aquí
    expect(field(current, "Ubicación aproximada")).toBe("Bogotá, Colombia");
    expect(field(current, "IP")).toBe("181.49.12.x");
    expect(field(phone, "IP")).toBe("2800:e2::/48");
    expect(field(current, "Inició")).toMatch(/2026/);
    expect(field(current, "Última actividad")).toMatch(/2026/);
    expect(phone.querySelector("[data-close]").getAttribute("aria-label")).toBe("Cerrar la sesión de Safari en iOS");
    expect(app().textContent).toContain("La ubicación es aproximada");
  });

  it("una sesión antigua sin datos: 'desconocida' (nunca vacío ni inventado)", async () => {
    await render();
    const old = items()[2];
    expect(old.querySelector(".session__device").textContent).toBe("Dispositivo desconocido");
    expect(field(old, "Ubicación aproximada")).toBe("desconocida");
    expect(field(old, "IP")).toBe("desconocida");
  });

  it("el contenido del servidor se escapa", async () => {
    await render([CURRENT, { ...PHONE, device: "<img src=x onerror=alert(1)>", location: "<b>X</b>" }]);
    expect(app().querySelector(".session img, .session b")).toBeNull();
    expect(items()[1].querySelector(".session__device").textContent).toContain("<img");
  });

  it("solo la actual: no ofrece cerrar las demás", async () => {
    await render([CURRENT]);
    expect(app().querySelector("#close-others")).toBeNull();
    expect(app().textContent).toContain("No hay otras sesiones abiertas.");
  });

  it("error al cargar: estado de error con Reintentar, que vuelve a pedir", async () => {
    setAuth("token", { id: "u1", name: "Ana", email: "a@x.co", role: "accountant", mfaEnabled: false });
    mfaApi.status.mockResolvedValue({ enabled: false, required: false });
    usersApi.sessions.mockRejectedValueOnce(new Error("No se pudo conectar")).mockResolvedValue([CURRENT]);
    await renderSecurity(app());
    await flush();
    expect(app().querySelector("#sessions").textContent).toContain("No se pudo conectar");
    app().querySelector("#sessions [data-retry]").click();
    await flush();
    expect(items()).toHaveLength(1);
  });

  it("admin sin MFA: no se pide la lista (la API solo le permite activarlo)", async () => {
    await render([CURRENT], { role: "admin", mfaEnabled: false });
    expect(usersApi.sessions).not.toHaveBeenCalled();
    expect(app().querySelector("#sessions-panel").hidden).toBe(true);
  });
});

describe("cerrar", () => {
  it("cerrar una: llama a la API con su id, avisa, recarga y lleva el foco al título", async () => {
    await render();
    usersApi.closeSession.mockResolvedValue(null);
    usersApi.sessions.mockResolvedValue([CURRENT, OLD]);
    items()[1].querySelector("[data-close]").click();
    await flush();
    expect(usersApi.closeSession).toHaveBeenCalledWith(PHONE.id);
    expect(toasts()).toContain("Cerraste esa sesión.");
    expect(items()).toHaveLength(2);
    expect(document.activeElement.id).toBe("sessions-title");
  });

  it("si falla, avisa y el botón vuelve a estar disponible", async () => {
    await render();
    usersApi.closeSession.mockRejectedValue(new Error("Esa sesión no existe o ya está cerrada."));
    const button = items()[1].querySelector("[data-close]");
    button.click();
    await flush();
    expect(toasts().join(" ")).toContain("ya está cerrada");
    expect(button.disabled).toBe(false);
  });

  it("cerrar las demás pide confirmación con cuántas; Volver no cierra nada y devuelve el foco", async () => {
    await render();
    app().querySelector("#close-others").click();
    const dialog = app().querySelector("#close-others-dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("Se cerrarán 2 sesiones en otros dispositivos. Esta sigue abierta.");
    dialog.querySelector('[data-dialog="back"]').click();
    expect(dialog.open).toBe(false);
    expect(usersApi.closeOtherSessions).not.toHaveBeenCalled();
    expect(document.activeElement.id).toBe("close-others");
  });

  it("confirmar: cierra las demás, avisa cuántas y queda solo la actual", async () => {
    await render();
    usersApi.closeOtherSessions.mockResolvedValue({ closed: 2 });
    usersApi.sessions.mockResolvedValue([CURRENT]);
    app().querySelector("#close-others").click();
    app().querySelector('#close-others-dialog [data-dialog="confirm"]').click();
    await flush();
    expect(usersApi.closeOtherSessions).toHaveBeenCalledTimes(1);
    expect(toasts()).toContain("Cerraste 2 sesiones.");
    expect(items()).toHaveLength(1);
    expect(document.activeElement.id).toBe("sessions-title");
  });

  it("una sola: el texto va en singular", async () => {
    await render([CURRENT, PHONE]);
    app().querySelector("#close-others").click();
    expect(app().querySelector("#close-others-text").textContent).toBe(
      "Se cerrará 1 sesión en otro dispositivo. Esta sigue abierta."
    );
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pantallas de B7: "Olvidé mi contraseña" y "Nueva contraseña" (públicas).
 * En Chrome real: e2e/passwordReset.spec.js.
 */

vi.mock("../src/api/auth.api.js", () => ({
  authApi: { requestPasswordReset: vi.fn(), lookupPasswordReset: vi.fn(), confirmPasswordReset: vi.fn() },
}));

const { authApi } = await import("../src/api/auth.api.js");
const { setAuth, clearAuth, getState } = await import("../src/state/store.js");
const { renderForgotPassword } = await import("../src/views/forgotPassword.view.js");
const { renderResetPassword } = await import("../src/views/resetPassword.view.js");

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const httpError = (status, message, details) => Object.assign(new Error(message), { status, details });
const TOKEN = "c".repeat(43) + "." + "d".repeat(43);
const SAME_MESSAGE = "Si el correo corresponde a una cuenta activa, te enviamos un enlace.";

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
});
afterEach(() => {
  vi.clearAllMocks();
  clearAuth();
  window.location.hash = "";
});

const app = () => document.getElementById("app");
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);

describe("Olvidé mi contraseña", () => {
  it("envía el correo y muestra siempre la misma confirmación (la que devuelve la API)", async () => {
    authApi.requestPasswordReset.mockResolvedValue({ message: SAME_MESSAGE });
    renderForgotPassword(app());
    const form = app().querySelector("#forgot-form");
    form.elements.email.value = "  ana@example.com ";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(authApi.requestPasswordReset).toHaveBeenCalledWith("ana@example.com");
    expect(app().querySelector("#forgot-form")).toBeNull();
    const status = app().querySelector("[role=status]");
    expect(status.textContent).toContain("Revisa tu correo");
    expect(status.textContent).toContain(SAME_MESSAGE);
  });

  it("sin red o con 429: avisa y deja el formulario para reintentar", async () => {
    authApi.requestPasswordReset.mockRejectedValue(httpError(429, "Demasiadas solicitudes"));
    renderForgotPassword(app());
    const form = app().querySelector("#forgot-form");
    form.elements.email.value = "ana@example.com";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(app().querySelector("#forgot-form")).not.toBeNull();
    expect(form.querySelector("button[type=submit]").disabled).toBe(false);
    expect(toasts().join(" ")).toContain("Demasiadas solicitudes");
  });

  it("tiene un camino de vuelta al login", () => {
    renderForgotPassword(app());
    expect(app().querySelector('a[href="#/login"]')).not.toBeNull();
  });
});

describe("Nueva contraseña", () => {
  const expiresAt = new Date(Date.now() + 15 * 60_000).toISOString();

  it("quita el token de la barra de direcciones, verifica el enlace y avisa que se cierran las sesiones", async () => {
    window.location.hash = `#/restablecer/${TOKEN}`;
    authApi.lookupPasswordReset.mockResolvedValue({ expiresAt });
    await renderResetPassword(app(), TOKEN);
    expect(window.location.hash).toBe("#/restablecer");
    expect(window.location.href).not.toContain(TOKEN);
    expect(authApi.lookupPasswordReset).toHaveBeenCalledWith(TOKEN);
    expect(app().textContent).toContain("se cerrarán todas tus sesiones");
    expect(app().querySelector("#token-form")).not.toBeNull();
  });

  it("valida que coincidan antes de llamar a la API", async () => {
    authApi.lookupPasswordReset.mockResolvedValue({ expiresAt });
    await renderResetPassword(app(), TOKEN);
    const form = app().querySelector("#token-form");
    form.elements.password.value = "una frase larga segura";
    form.elements.confirm.value = "otra frase distinta";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(app().querySelector("#token-error").textContent).toBe("Las dos contraseñas no coinciden.");
    expect(authApi.confirmPasswordReset).not.toHaveBeenCalled();
  });

  it("al guardar: olvida la sesión local, confirma y lleva al login", async () => {
    setAuth("t", { id: "1", name: "Ana", role: "accountant" });
    authApi.lookupPasswordReset.mockResolvedValue({ expiresAt });
    authApi.confirmPasswordReset.mockResolvedValue(undefined);
    await renderResetPassword(app(), TOKEN);
    const form = app().querySelector("#token-form");
    form.elements.password.value = form.elements.confirm.value = "una frase larga segura";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(authApi.confirmPasswordReset).toHaveBeenCalledWith(TOKEN, "una frase larga segura");
    expect(getState().user).toBeNull();
    expect(window.location.hash).toBe("#/login");
    expect(toasts()[0]).toContain("se cerraron todas tus sesiones");
  });

  it("enlace vencido o usado (410): mensaje claro y enlace para pedir uno nuevo", async () => {
    authApi.lookupPasswordReset.mockRejectedValue(httpError(410, "no válido"));
    await renderResetPassword(app(), TOKEN);
    expect(app().querySelector("#token-form")).toBeNull();
    expect(app().querySelector("[role=alert]").textContent).toContain("no es válido o ya venció");
    expect(app().querySelector('a[href="#/recuperar"]')).not.toBeNull();
  });

  it("si vence mientras se escribe (410 al guardar): reemplaza el formulario por el aviso", async () => {
    authApi.lookupPasswordReset.mockResolvedValue({ expiresAt });
    authApi.confirmPasswordReset.mockRejectedValue(httpError(410, "no válido"));
    await renderResetPassword(app(), TOKEN);
    const form = app().querySelector("#token-form");
    form.elements.password.value = form.elements.confirm.value = "una frase larga segura";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(app().querySelector("#token-form")).toBeNull();
    expect(app().querySelector('a[href="#/recuperar"]')).not.toBeNull();
  });

  it("sin token (tras recargar): pide abrir el enlace del correo, sin llamar a la API", async () => {
    await renderResetPassword(app(), undefined);
    expect(app().textContent).toContain("Abre el enlace que recibiste por correo.");
    expect(authApi.lookupPasswordReset).not.toHaveBeenCalled();
  });
});

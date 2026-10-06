import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pantallas de B9: segundo paso del login, "Seguridad" (activar, códigos de
 * recuperación, desactivar) y MFA obligatorio para admin en el guard.
 * En Chrome real: e2e/mfa.spec.js.
 */

vi.mock("../src/api/auth.api.js", () => ({ authApi: { login: vi.fn(), loginMfa: vi.fn() } }));
vi.mock("../src/api/mfa.api.js", () => ({
  mfaApi: { status: vi.fn(), setup: vi.fn(), enable: vi.fn(), disable: vi.fn(), regenerateCodes: vi.fn() },
}));
vi.mock("../src/auth/session.js", () => ({ startSession: vi.fn(), logout: vi.fn() }));

const { authApi } = await import("../src/api/auth.api.js");
const { mfaApi } = await import("../src/api/mfa.api.js");
const { startSession } = await import("../src/auth/session.js");
const { setAuth, clearAuth, getState } = await import("../src/state/store.js");
const { renderLogin } = await import("../src/views/login.view.js");
const { renderSecurity } = await import("../src/views/security.view.js");
const { decideRoute } = await import("../src/auth/routeAccess.js");
const { noticeText } = await import("../src/components/routeNotice.js");

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const httpError = (status, message, code) => Object.assign(new Error(message), { status, code });
const app = () => document.getElementById("app");
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);
const submit = (form) => form.dispatchEvent(new Event("submit", { cancelable: true }));

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
});
afterEach(() => {
  vi.clearAllMocks();
  clearAuth();
  window.location.hash = "";
});

describe("guard: MFA obligatorio para admin", () => {
  const route = (meta) => ({ pattern: "/x", meta });

  it("un admin sin MFA solo puede entrar a las rutas de configurarlo, con un aviso que lo explica", () => {
    const pending = { hasSession: true, role: "admin", mfaPending: true };
    const decision = decideRoute(route({ auth: true, label: "Clientes" }), pending);
    expect(decision).toEqual({ redirect: "/seguridad", notice: { reason: "mfa" } });
    expect(noticeText(decision.notice)).toContain("verificación en dos pasos");
    expect(decideRoute(route({ auth: true, mfaSetup: true }), pending)).toBeNull();
    expect(decideRoute(route({ auth: false }), pending)).toBeNull();
    expect(decideRoute(route({ auth: true, roles: ["admin"] }), { ...pending, mfaPending: false })).toBeNull();
  });
});

describe("login con verificación en dos pasos", () => {
  async function toMfaStep() {
    authApi.login.mockResolvedValue({ mfaRequired: true, challengeToken: "paso-1", expiresAt: "x" });
    renderLogin(app());
    const form = app().querySelector("#login-form");
    form.elements.email.value = "ana@example.com";
    form.elements.password.value = "una contraseña";
    submit(form);
    await flush();
    return app().querySelector("#mfa-form");
  }

  it("con MFA, la contraseña no inicia sesión: pide el código y lo enfoca", async () => {
    const form = await toMfaStep();
    expect(startSession).not.toHaveBeenCalled();
    expect(form).not.toBeNull();
    const input = form.elements.code;
    expect([input.inputMode, input.autocomplete]).toEqual(["numeric", "one-time-code"]);
    expect(document.activeElement).toBe(input);
    expect(app().querySelector("h1").textContent).toBe("Verificación en dos pasos");
  });

  it("valida 6 dígitos en el navegador; con el código correcto inicia sesión", async () => {
    const form = await toMfaStep();
    form.elements.code.value = "12345";
    submit(form);
    expect(app().querySelector("#mfa-error").textContent).toBe("El código tiene 6 dígitos.");
    expect(authApi.loginMfa).not.toHaveBeenCalled();

    const session = { accessToken: "t", user: { id: "1", name: "Ana", role: "accountant", mfaEnabled: true } };
    authApi.loginMfa.mockResolvedValue(session);
    form.elements.code.value = "123456";
    submit(form);
    await flush();
    expect(authApi.loginMfa).toHaveBeenCalledWith("paso-1", "123456");
    expect(startSession).toHaveBeenCalledWith(session);
    expect(window.location.hash).toBe("#/");
  });

  it("código incorrecto: muestra el motivo y deja reintentar", async () => {
    const form = await toMfaStep();
    authApi.loginMfa.mockRejectedValue(httpError(401, "El código no es correcto."));
    form.elements.code.value = "000000";
    submit(form);
    await flush();
    expect(app().querySelector("#mfa-error").textContent).toBe("El código no es correcto.");
    expect(form.querySelector("button[type=submit]").disabled).toBe(false);
  });

  it("paso vencido o agotado: vuelve a pedir la contraseña con un aviso", async () => {
    const form = await toMfaStep();
    authApi.loginMfa.mockRejectedValue(httpError(401, "La verificación venció.", "mfa_challenge_invalid"));
    form.elements.code.value = "123456";
    submit(form);
    await flush();
    expect(app().querySelector("#login-form")).not.toBeNull();
    expect(toasts()[0]).toContain("La verificación venció.");
  });

  it("se puede usar un código de recuperación (cambia etiqueta, teclado y validación)", async () => {
    const form = await toMfaStep();
    app().querySelector("#mfa-mode").click();
    const input = form.elements.code;
    expect(form.querySelector("label").textContent).toBe("Código de recuperación");
    expect([input.inputMode, input.autocomplete]).toEqual(["text", "off"]);
    authApi.loginMfa.mockResolvedValue({ accessToken: "t", user: { id: "1", name: "Ana" } });
    input.value = "ABCD-EFGH-JKMN-PQRS";
    submit(form);
    await flush();
    expect(authApi.loginMfa).toHaveBeenCalledWith("paso-1", "ABCD-EFGH-JKMN-PQRS");
  });
});

describe("Seguridad", () => {
  const SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 57 57"><path d="M4 4h7v1H4z"/></svg>`;
  const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CCCC-000${i}`);

  beforeEach(() =>
    setAuth("t", { id: "a1", name: "Admin", email: "admin@example.com", role: "admin", mfaEnabled: false })
  );

  it("activar: contraseña → QR (imagen del servidor, sin insertar el SVG) + clave → códigos de recuperación", async () => {
    mfaApi.status.mockResolvedValue({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0, required: true });
    await renderSecurity(app());
    expect(app().textContent).toContain("Tu rol (Administrador) exige la verificación en dos pasos");

    mfaApi.setup.mockResolvedValue({
      secret: "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP",
      qrSvg: SVG,
      expiresAt: new Date().toISOString(),
    });
    const start = app().querySelector("#mfa-start");
    start.elements.password.value = "mi contraseña";
    submit(start);
    await flush();
    expect(mfaApi.setup).toHaveBeenCalledWith("mi contraseña");
    const img = app().querySelector("img.mfa-qr");
    expect(img.getAttribute("src")).toBe(`data:image/svg+xml,${encodeURIComponent(SVG)}`);
    expect(img.alt).toContain("Código QR");
    expect(app().querySelector("svg")).toBeNull(); // no se inserta marcado del servidor
    expect(app().querySelector("#mfa-secret").textContent).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");

    // Aviso del guard ("primero debes activar…"): deja de aplicar al activarla.
    app()
      .querySelector("#main-content")
      .insertAdjacentHTML("afterbegin", '<div class="route-notice" role="alert"></div>');
    mfaApi.enable.mockResolvedValue({ recoveryCodes: CODES });
    const enable = app().querySelector("#mfa-enable");
    enable.elements.code.value = "123456";
    submit(enable);
    await flush();
    expect(mfaApi.enable).toHaveBeenCalledWith("123456");
    expect([...app().querySelectorAll("#mfa-codes li")].map((li) => li.textContent)).toEqual(CODES);
    expect(getState().user.mfaEnabled).toBe(true); // el guard deja de retenerlo en "Seguridad"
    expect(document.querySelector(".route-notice")).toBeNull();
    expect(app().querySelector("#mfa-done input[type=checkbox]").required).toBe(true);
  });

  it("errores del servidor (contraseña o código incorrectos) se muestran junto al formulario", async () => {
    mfaApi.status.mockResolvedValue({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0, required: false });
    mfaApi.setup.mockRejectedValue(httpError(400, "La contraseña no es correcta."));
    await renderSecurity(app());
    const start = app().querySelector("#mfa-start");
    start.elements.password.value = "otra";
    submit(start);
    await flush();
    expect(app().querySelector("#mfa-start-error").textContent).toBe("La contraseña no es correcta.");
  });

  it("activa y obligatoria (admin): sin opción de desactivar; avisa si quedan pocos códigos", async () => {
    mfaApi.status.mockResolvedValue({
      enabled: true,
      enabledAt: "2026-10-06T12:00:00.000Z",
      recoveryCodesRemaining: 2,
      required: true,
    });
    await renderSecurity(app());
    expect(app().querySelector("#mfa-disable")).toBeNull();
    expect(app().textContent).toContain("no se puede desactivar");
    expect(app().textContent).toContain("Genera códigos nuevos");
  });

  it("activa y opcional: desactivar pide contraseña y código, y actualiza la sesión local", async () => {
    setAuth("t", { id: "c1", name: "Ana", role: "accountant", mfaEnabled: true });
    mfaApi.status
      .mockResolvedValueOnce({
        enabled: true,
        enabledAt: "2026-10-06T12:00:00.000Z",
        recoveryCodesRemaining: 10,
        required: false,
      })
      .mockResolvedValueOnce({ enabled: false, enabledAt: null, recoveryCodesRemaining: 0, required: false });
    mfaApi.disable.mockResolvedValue(undefined);
    await renderSecurity(app());
    const form = app().querySelector("#mfa-disable");
    form.elements.password.value = "mi contraseña";
    form.elements.code.value = "123456";
    submit(form);
    await flush();
    expect(mfaApi.disable).toHaveBeenCalledWith("mi contraseña", "123456");
    expect(getState().user.mfaEnabled).toBe(false);
    expect(app().querySelector("#mfa-start")).not.toBeNull();
  });
});

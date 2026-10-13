import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Mi perfil" y "Confirmar correo" (B11). En Chrome real: e2e/profile.spec.js.
 */

vi.mock("../src/api/users.api.js", () => ({
  usersApi: {
    me: vi.fn(),
    update: vi.fn(),
    requestEmailChange: vi.fn(),
    cancelEmailChange: vi.fn(),
    changePassword: vi.fn(),
    // "Tus datos" (B14) lo pide al montar el perfil.
    deletionStatus: vi.fn(() => Promise.resolve({ canDelete: true })),
  },
}));
vi.mock("../src/api/auth.api.js", () => ({ authApi: { confirmEmailChange: vi.fn() } }));
vi.mock("../src/auth/session.js", () => ({ startSession: vi.fn(), logout: vi.fn() }));

const { usersApi } = await import("../src/api/users.api.js");
const { authApi } = await import("../src/api/auth.api.js");
const { setAuth, clearAuth, getState } = await import("../src/state/store.js");
const { renderProfile } = await import("../src/views/profile.view.js");
const { renderConfirmEmail } = await import("../src/views/confirmEmail.view.js");

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const httpError = (status, message, details) => Object.assign(new Error(message), { status, details });
const app = () => document.getElementById("app");
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);
const submit = (form) => form.dispatchEvent(new Event("submit", { cancelable: true }));
const ME = {
  id: "u1",
  name: "Ana Contadora",
  email: "ana@example.com",
  role: "accountant",
  phone: null,
  mfaEnabled: false,
  pendingEmail: null,
};

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  setAuth("t", { id: "u1", name: "Ana Contadora", email: "ana@example.com", role: "accountant" });
});
afterEach(() => {
  vi.clearAllMocks();
  clearAuth();
  window.location.hash = "";
});

describe("Mi perfil", () => {
  it("muestra nombre, teléfono, rol y correo; guarda nombre y teléfono y actualiza la sesión local", async () => {
    usersApi.me.mockResolvedValue({ ...ME, phone: "3001234567" });
    await renderProfile(app());
    const form = app().querySelector("#profile-form");
    expect(form.elements.name.value).toBe("Ana Contadora");
    expect(form.elements.phone.value).toBe("3001234567");
    expect(app().textContent).toContain("Contador/a");
    expect(app().querySelector("#profile-email").textContent).toBe("ana@example.com");

    usersApi.update.mockResolvedValue({ ...ME, name: "Ana María", phone: null });
    form.elements.name.value = "  Ana María ";
    form.elements.phone.value = " ";
    submit(form);
    await flush();
    expect(usersApi.update).toHaveBeenCalledWith({ name: "Ana María", phone: "" });
    expect(getState().user.name).toBe("Ana María"); // el menú de la cuenta lo muestra
    expect(toasts()[0]).toContain("Guardamos tus datos");
  });

  it("los motivos de la API (400 por campo) se muestran junto al formulario", async () => {
    usersApi.me.mockResolvedValue(ME);
    usersApi.update.mockRejectedValue(
      httpError(400, "Datos inválidos", [{ field: "body.phone", message: "Usa solo dígitos" }])
    );
    await renderProfile(app());
    submit(app().querySelector("#profile-form"));
    await flush();
    expect(app().querySelector("#profile-error").textContent).toBe("Usa solo dígitos.");
  });

  it("cambiar el correo pide la contraseña; muestra el cambio pendiente y permite cancelarlo", async () => {
    usersApi.me.mockResolvedValueOnce(ME).mockResolvedValue({
      ...ME,
      pendingEmail: { email: "nuevo@example.com", expiresAt: "2026-10-07T12:00:00.000Z" },
    });
    usersApi.requestEmailChange.mockResolvedValue({ pendingEmail: { email: "nuevo@example.com" } });
    await renderProfile(app());
    const form = app().querySelector("#email-form");
    form.elements.newEmail.value = " nuevo@example.com ";
    form.elements.password.value = "mi contraseña";
    submit(form);
    await flush();
    expect(usersApi.requestEmailChange).toHaveBeenCalledWith("nuevo@example.com", "mi contraseña");
    expect(toasts()[0]).toContain("no cambia hasta que lo abras");
    expect(app().querySelector("#profile-pending").textContent).toContain("nuevo@example.com");

    usersApi.cancelEmailChange.mockResolvedValue(undefined);
    usersApi.me.mockResolvedValue(ME);
    app().querySelector("#profile-cancel-email").click();
    await flush();
    expect(usersApi.cancelEmailChange).toHaveBeenCalled();
    expect(app().querySelector("#profile-pending")).toBeNull();
  });

  it("cambiar la contraseña: valida que coincidan antes de llamar a la API; al cambiarla, avisa cuántas sesiones cerró", async () => {
    usersApi.me.mockResolvedValue(ME);
    await renderProfile(app());
    const form = app().querySelector("#password-form");
    form.elements.currentPassword.value = "actual";
    form.elements.newPassword.value = "una frase nueva larga";
    form.elements.confirm.value = "otra cosa distinta";
    submit(form);
    await flush();
    expect(app().querySelector("#password-error").textContent).toBe("Las dos contraseñas nuevas no coinciden.");
    expect(usersApi.changePassword).not.toHaveBeenCalled();

    usersApi.changePassword.mockResolvedValue({ closedSessions: 2 });
    form.elements.confirm.value = "una frase nueva larga";
    submit(form);
    await flush();
    expect(usersApi.changePassword).toHaveBeenCalledWith("actual", "una frase nueva larga");
    expect(toasts().at(-1)).toContain("cerramos 2 sesiones más");
    expect(form.elements.newPassword.value).toBe(""); // el formulario se limpia
  });
});

describe("Confirmar correo", () => {
  const TOKEN = "a".repeat(43) + "." + "b".repeat(43);

  it("quita el token de la barra, confirma y actualiza el correo de la sesión local", async () => {
    window.location.hash = `#/confirmar-correo/${TOKEN}`;
    authApi.confirmEmailChange.mockResolvedValue({ email: "nuevo@example.com" });
    await renderConfirmEmail(app(), TOKEN);
    expect(window.location.hash).toBe("#/confirmar-correo");
    expect(authApi.confirmEmailChange).toHaveBeenCalledWith(TOKEN);
    expect(app().textContent).toContain("nuevo@example.com");
    expect(getState().user.email).toBe("nuevo@example.com");
  });

  it("enlace inválido o vencido (410) y correo tomado (409): mensajes claros", async () => {
    authApi.confirmEmailChange.mockRejectedValueOnce(httpError(410, "no válido"));
    await renderConfirmEmail(app(), TOKEN);
    expect(app().querySelector("[role=alert]").textContent).toContain("no es válido o ya venció");
    authApi.confirmEmailChange.mockRejectedValueOnce(httpError(409, "en uso"));
    await renderConfirmEmail(app(), TOKEN);
    expect(app().querySelector("[role=alert]").textContent).toContain("ya está en uso");
  });

  it("sin token: pide abrir el enlace del correo, sin llamar a la API", () => {
    renderConfirmEmail(app(), undefined);
    expect(app().textContent).toContain("Abre el enlace que recibiste por correo.");
    expect(authApi.confirmEmailChange).not.toHaveBeenCalled();
  });
});

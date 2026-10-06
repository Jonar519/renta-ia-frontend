import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Pantallas de B6: administración de invitaciones (solo admin) y
 * "Completa tu cuenta" (pública). En Chrome real: e2e/invitations.spec.js.
 */

vi.mock("../src/api/admin.api.js", () => ({
  adminApi: {
    listInvitations: vi.fn(),
    invite: vi.fn(),
    resendInvitation: vi.fn(),
    cancelInvitation: vi.fn(),
    accountants: vi.fn(),
    portalClients: vi.fn(),
  },
}));
vi.mock("../src/api/auth.api.js", () => ({
  authApi: { lookupInvitation: vi.fn(), acceptInvitation: vi.fn(), login: vi.fn() },
}));
vi.mock("../src/auth/session.js", () => ({ startSession: vi.fn(), logout: vi.fn() }));

const { adminApi } = await import("../src/api/admin.api.js");
const { authApi } = await import("../src/api/auth.api.js");
const { startSession } = await import("../src/auth/session.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { renderAdminUsers, untilText } = await import("../src/views/adminUsers.view.js");
const { renderCompleteAccount } = await import("../src/views/completeAccount.view.js");
const { bindPasswordFields, passwordFieldHtml } = await import("../src/components/passwordField.js");

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0));
};
const httpError = (status, message, details) => Object.assign(new Error(message), { status, details });
const TOKEN = "a".repeat(43) + "." + "b".repeat(43);

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  // jsdom no implementa <dialog>.showModal/close completos.
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
  window.location.hash = "";
});

const app = () => document.getElementById("app");
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);

describe("campo de contraseña con 'Mostrar contraseña'", () => {
  it("alterna el tipo con aria-pressed, conserva el nombre y vuelve a ocultar al enviar", () => {
    app().innerHTML = `<form>${passwordFieldHtml({ id: "p", name: "password", label: "Contraseña", autocomplete: "new-password" })}</form>`;
    bindPasswordFields(app());
    const input = app().querySelector("#p");
    const toggle = app().querySelector(".password-field__toggle");
    const name = toggle.textContent.replace(/\s+/g, " ").trim();
    expect(name).toBe("Mostrar contraseña");
    expect(app().querySelector("label").getAttribute("for")).toBe("p");

    toggle.click();
    expect([input.type, toggle.getAttribute("aria-pressed")]).toEqual(["text", "true"]);
    expect(toggle.textContent.replace(/\s+/g, " ").trim()).toBe(name); // el nombre NO cambia
    toggle.click();
    expect([input.type, toggle.getAttribute("aria-pressed")]).toEqual(["password", "false"]);

    toggle.click();
    app()
      .querySelector("form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(input.type).toBe("password");
  });
});

describe("Completa tu cuenta", () => {
  const invitation = {
    name: "Laura Gómez",
    email: "laura@example.com",
    role: "assistant",
    expiresAt: "2026-10-09T15:00:00.000Z",
    mfaRequired: false,
  };

  it("quita el token de la barra de direcciones y muestra a quién corresponde el enlace", async () => {
    window.location.hash = `#/invitacion/${TOKEN}`;
    authApi.lookupInvitation.mockResolvedValue(invitation);
    await renderCompleteAccount(app(), TOKEN);
    expect(window.location.hash).toBe("#/invitacion");
    expect(window.location.href).not.toContain(TOKEN);
    expect(authApi.lookupInvitation).toHaveBeenCalledWith(TOKEN);
    expect(app().textContent).toContain("Laura Gómez");
    expect(app().textContent).toContain("Asistente");
    const email = app().querySelector("#complete-email");
    expect([email.value, email.readOnly]).toEqual(["laura@example.com", true]);
  });

  it("valida en el navegador que las contraseñas coincidan antes de llamar a la API", async () => {
    authApi.lookupInvitation.mockResolvedValue(invitation);
    await renderCompleteAccount(app(), TOKEN);
    const form = app().querySelector("#token-form");
    form.elements.password.value = "una frase larga segura";
    form.elements.confirm.value = "otra frase distinta";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(app().querySelector("#token-error").textContent).toBe("Las dos contraseñas no coinciden.");
    expect(authApi.acceptInvitation).not.toHaveBeenCalled();
  });

  it("muestra los motivos de la política de contraseñas que devuelve la API", async () => {
    authApi.lookupInvitation.mockResolvedValue(invitation);
    authApi.acceptInvitation.mockRejectedValue(
      httpError(400, "Datos inválidos", [{ field: "body.password", message: "No puede contener tu nombre" }])
    );
    await renderCompleteAccount(app(), TOKEN);
    const form = app().querySelector("#token-form");
    form.elements.password.value = form.elements.confirm.value = "laura-gomez-2026";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(app().querySelector("#token-error").textContent).toBe("No puede contener tu nombre.");
  });

  it("al activar: inicia la sesión, confirma y lleva a Clientes", async () => {
    authApi.lookupInvitation.mockResolvedValue(invitation);
    const session = { accessToken: "t", user: { id: "1", name: "Laura Gómez", role: "assistant" } };
    authApi.acceptInvitation.mockResolvedValue(session);
    await renderCompleteAccount(app(), TOKEN);
    const form = app().querySelector("#token-form");
    form.elements.password.value = form.elements.confirm.value = "una frase larga segura";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(authApi.acceptInvitation).toHaveBeenCalledWith(TOKEN, "una frase larga segura");
    expect(startSession).toHaveBeenCalledWith(session);
    expect(window.location.hash).toBe("#/");
    expect(toasts()[0]).toContain("Tu cuenta está activa");
  });

  it("enlace inválido o vencido (410): mensaje claro y sin formulario", async () => {
    authApi.lookupInvitation.mockRejectedValue(httpError(410, "no válido"));
    await renderCompleteAccount(app(), TOKEN);
    expect(app().querySelector("#token-form")).toBeNull();
    expect(app().querySelector("[role=alert]").textContent).toContain("no es válido o ya venció");
  });

  it("error de red: Reintentar vuelve a verificar sin recargar", async () => {
    authApi.lookupInvitation
      .mockRejectedValueOnce(httpError(undefined, "Sin conexión"))
      .mockResolvedValueOnce(invitation);
    await renderCompleteAccount(app(), TOKEN);
    app().querySelector("[data-retry]").click();
    await flush();
    expect(authApi.lookupInvitation).toHaveBeenCalledTimes(2);
    expect(app().querySelector("#token-form")).not.toBeNull();
  });

  it("sin token (p. ej. tras recargar): indica abrir de nuevo el enlace, sin llamar a la API", async () => {
    await renderCompleteAccount(app(), undefined);
    expect(app().textContent).toContain("Abre el enlace que recibiste por correo.");
    expect(authApi.lookupInvitation).not.toHaveBeenCalled();
  });
});

describe("Usuarios (administración de invitaciones)", () => {
  const now = Date.now();
  const pending = {
    userId: "u-1",
    name: "Pedro Ruiz",
    email: "pedro@example.com",
    role: "assistant",
    status: "pending",
    invitedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 72 * 3600_000).toISOString(),
    accountant: { id: "c-1", name: "Ana Contadora" },
    client: null,
  };
  const expired = {
    ...pending,
    userId: "u-2",
    name: "Marta Díaz",
    email: "marta@example.com",
    role: "accountant",
    status: "expired",
    expiresAt: new Date(now - 3600_000).toISOString(),
    accountant: null,
  };

  beforeEach(() => setAuth("t", { id: "admin", name: "Admin", role: "admin" }));

  it("lista estado y vencimiento de cada invitación, con su vínculo", async () => {
    adminApi.listInvitations.mockResolvedValue({ items: [pending, expired] });
    await renderAdminUsers(app());
    const rows = [...app().querySelectorAll("#invitations-tbody tr")];
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Pendiente");
    expect(rows[0].textContent).toContain("Asiste a Ana Contadora");
    expect(rows[0].textContent).toContain("Vence");
    expect(rows[1].querySelector(".badge").textContent).toBe("Vencida");
    expect(rows[1].textContent).toContain("Venció");
    expect(untilText(new Date(now + 3 * 86400_000).toISOString(), now)).toBe("dentro de 3 días");
  });

  it("vacío orientativo y error con Reintentar", async () => {
    adminApi.listInvitations.mockRejectedValueOnce(httpError(500, "Falla")).mockResolvedValueOnce({ items: [] });
    await renderAdminUsers(app());
    expect(app().querySelector(".state--error")).not.toBeNull();
    app().querySelector("[data-retry]").click();
    await flush();
    expect(app().querySelector(".state--empty").textContent).toContain("No hay invitaciones pendientes.");
  });

  it("invitar un asistente: carga los contadores, envía solo nombre, correo, rol y contador (sin contraseña)", async () => {
    adminApi.listInvitations.mockResolvedValue({ items: [] });
    adminApi.accountants.mockResolvedValue({ items: [{ id: "c-1", name: "Ana", email: "ana@example.com" }] });
    adminApi.invite.mockResolvedValue(pending);
    await renderAdminUsers(app());
    const form = app().querySelector("#invite-form");
    expect(form.querySelector("input[type=password]")).toBeNull();
    form.elements.name.value = "Pedro Ruiz";
    form.elements.email.value = "pedro@example.com";
    form.elements.role.value = "assistant";
    form.elements.role.dispatchEvent(new Event("change"));
    await flush();
    form.elements.accountantUserId.value = "c-1";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(adminApi.invite).toHaveBeenCalledWith({
      name: "Pedro Ruiz",
      email: "pedro@example.com",
      role: "assistant",
      accountantUserId: "c-1",
    });
    expect(toasts()[0]).toContain("El enlace llega solo a ese correo");
    expect(adminApi.listInvitations).toHaveBeenCalledTimes(2);
  });

  it("invitar un contribuyente: busca expedientes sin portal y no envía el texto de búsqueda", async () => {
    adminApi.listInvitations.mockResolvedValue({ items: [] });
    adminApi.portalClients.mockResolvedValue({
      items: [{ id: "x-1", fullName: "Carlos Pérez", documentNumber: "1020", accountant: { name: "Ana" } }],
    });
    adminApi.invite.mockResolvedValue(pending);
    await renderAdminUsers(app());
    const form = app().querySelector("#invite-form");
    form.elements.role.value = "client";
    form.elements.role.dispatchEvent(new Event("change"));
    await flush();
    form.elements.clientQuery.value = "carlos";
    app().querySelector("[data-action=search-clients]").click();
    await flush();
    expect(adminApi.portalClients).toHaveBeenLastCalledWith("carlos");
    form.elements.name.value = "Carlos";
    form.elements.email.value = "carlos@example.com";
    form.elements.clientId.value = "x-1";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(adminApi.invite.mock.calls[0][0]).toEqual({
      name: "Carlos",
      email: "carlos@example.com",
      role: "client",
      clientId: "x-1",
    });
  });

  it("reenviar actualiza la fila y avisa que el enlace anterior ya no sirve", async () => {
    adminApi.listInvitations.mockResolvedValue({ items: [expired] });
    adminApi.resendInvitation.mockResolvedValue({ ...expired, status: "pending", expiresAt: pending.expiresAt });
    await renderAdminUsers(app());
    app().querySelector("[data-action=resend]").click();
    await flush();
    expect(adminApi.resendInvitation).toHaveBeenCalledWith("u-2");
    expect(app().querySelector("#invitations-tbody .badge").textContent).toBe("Pendiente");
    expect(toasts()[0]).toContain("El anterior ya no sirve");
  });

  it("cancelar pide confirmación en un diálogo; 'Volver' no cancela y devuelve el foco", async () => {
    adminApi.listInvitations.mockResolvedValue({ items: [pending] });
    await renderAdminUsers(app());
    const cancel = app().querySelector("[data-action=cancel]");
    cancel.click();
    const dialog = app().querySelector("#cancel-dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("pedro@example.com");
    dialog.querySelector("[data-dialog=back]").click();
    await flush();
    expect(dialog.open).toBe(false);
    expect(adminApi.cancelInvitation).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(cancel);
  });

  it("confirmar la cancelación llama a la API, confirma y recarga la lista", async () => {
    adminApi.listInvitations.mockResolvedValueOnce({ items: [pending] }).mockResolvedValueOnce({ items: [] });
    adminApi.cancelInvitation.mockResolvedValue(undefined);
    await renderAdminUsers(app());
    app().querySelector("[data-action=cancel]").click();
    app().querySelector("[data-dialog=confirm]").click();
    await flush();
    expect(adminApi.cancelInvitation).toHaveBeenCalledWith("u-1");
    expect(toasts()[0]).toContain("cancelada");
    expect(app().querySelector(".state--empty")).not.toBeNull();
  });
});

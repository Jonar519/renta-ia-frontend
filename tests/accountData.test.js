import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Tus datos" en Mi perfil (B14): descargar (pide contraseña) y eliminar la
 * cuenta (contraseña, código si tiene MFA, casilla y confirmación). En Chrome
 * real: e2e/accountData.spec.js.
 */

vi.mock("../src/api/users.api.js", () => ({
  usersApi: { exportData: vi.fn(), deletionStatus: vi.fn(), deleteAccount: vi.fn() },
}));
vi.mock("../src/auth/session.js", () => ({ logout: vi.fn() }));

const { usersApi } = await import("../src/api/users.api.js");
const { logout } = await import("../src/auth/session.js");
const { mountAccountData } = await import("../src/views/accountData.js");

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};
const slot = () => document.getElementById("account-data");
const q = (sel) => slot().querySelector(sel);
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);
const submit = (form) => form.dispatchEvent(new Event("submit", { cancelable: true }));

async function mount(me = { mfaEnabled: false }, status = { canDelete: true, reason: null }) {
  usersApi.deletionStatus.mockResolvedValue(status);
  await mountAccountData(slot(), me);
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="account-data"></div>`;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
  URL.createObjectURL ??= () => "blob:x";
  URL.revokeObjectURL ??= () => {};
});
afterEach(() => vi.clearAllMocks());

describe("descargar mis datos", () => {
  it("manda la contraseña, descarga un .json con la fecha y avisa", async () => {
    await mount();
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    usersApi.exportData.mockResolvedValue({ format: "renta-ia-export-v1" });
    q("#export-password").value = "mi-clave";
    submit(q("#export-form"));
    await flush();
    expect(usersApi.exportData).toHaveBeenCalledWith("mi-clave");
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(clicked.mock.contexts[0].download).toMatch(/^renta-ia-mis-datos-\d{4}-\d{2}-\d{2}\.json$/);
    expect(toasts()).toContain("Descargamos tus datos.");
    clicked.mockRestore();
  });

  it("contraseña incorrecta: el mensaje del servidor junto al formulario", async () => {
    await mount();
    usersApi.exportData.mockRejectedValue(new Error("La contraseña actual no es correcta."));
    q("#export-password").value = "otra";
    submit(q("#export-form"));
    await flush();
    expect(q("#export-error").textContent).toBe("La contraseña actual no es correcta.");
  });
});

describe("eliminar mi cuenta", () => {
  it("explica qué se borra y qué se conserva (los documentos, en el expediente del cliente)", async () => {
    await mount();
    expect(slot().textContent).toContain('con autor "Cuenta eliminada"');
    expect(slot().textContent).toContain("No se puede deshacer");
  });

  it("si no se puede (contador con clientes), lo dice y no ofrece el formulario", async () => {
    await mount({ mfaEnabled: false }, { canDelete: false, reason: "Tienes 3 clientes a tu cargo. <b>x</b>" });
    expect(q("#delete-form")).toBeNull();
    expect(q("#delete-blocked").textContent).toBe("Tienes 3 clientes a tu cargo. <b>x</b>"); // escapado
  });

  it("pide el código solo si la cuenta tiene MFA", async () => {
    await mount({ mfaEnabled: false });
    expect(q("#delete-code")).toBeNull();
    document.body.innerHTML = `<div id="toast-root"></div><div id="account-data"></div>`;
    await mount({ mfaEnabled: true });
    expect(q("#delete-code")).not.toBeNull();
  });

  it("sin contraseña, sin código (con MFA) o sin la casilla: no abre la confirmación", async () => {
    await mount({ mfaEnabled: true });
    const dialog = q("#delete-dialog");
    submit(q("#delete-form"));
    expect(q("#delete-error").textContent).toBe("Escribe tu contraseña y un código.");
    q("#delete-password").value = "clave";
    q("#delete-code").value = "123456";
    submit(q("#delete-form"));
    expect(q("#delete-error").textContent).toContain("Marca la casilla");
    expect(dialog.open).toBeFalsy();
  });

  it("confirmar: elimina con contraseña y código, avisa y cierra la sesión", async () => {
    await mount({ mfaEnabled: true });
    usersApi.deleteAccount.mockResolvedValue(null);
    q("#delete-password").value = "clave";
    q("#delete-code").value = " 123456 ";
    q("[name=understood]").checked = true;
    submit(q("#delete-form"));
    expect(q("#delete-dialog").open).toBe(true);
    expect(usersApi.deleteAccount).not.toHaveBeenCalled(); // todavía no
    q('#delete-dialog [data-dialog="confirm"]').click();
    await flush();
    expect(usersApi.deleteAccount).toHaveBeenCalledWith("clave", "123456");
    expect(toasts()).toContain("Eliminamos tu cuenta. Gracias por usar Renta IA.");
    expect(logout).toHaveBeenCalledTimes(1);
  });

  it("Volver no elimina nada y devuelve el foco al botón", async () => {
    await mount();
    q("#delete-password").value = "clave";
    q("[name=understood]").checked = true;
    submit(q("#delete-form"));
    q('#delete-dialog [data-dialog="back"]').click();
    expect(usersApi.deleteAccount).not.toHaveBeenCalled();
    expect(document.activeElement.textContent).toBe("Eliminar mi cuenta");
  });

  it("si la API la rechaza (código incorrecto, 409), muestra el motivo y no cierra la sesión", async () => {
    await mount();
    usersApi.deleteAccount.mockRejectedValue(new Error("El código no es correcto."));
    q("#delete-password").value = "clave";
    q("[name=understood]").checked = true;
    submit(q("#delete-form"));
    q('#delete-dialog [data-dialog="confirm"]').click();
    await flush();
    expect(q("#delete-error").textContent).toBe("El código no es correcto.");
    expect(logout).not.toHaveBeenCalled();
  });

  it("si el perfil se volvió a pintar mientras llegaba el estado, no se monta dos veces", async () => {
    let resolve;
    usersApi.deletionStatus.mockReturnValue(new Promise((r) => (resolve = r)));
    const stale = slot();
    const pending = mountAccountData(stale, { mfaEnabled: false });
    document.body.innerHTML = `<div id="toast-root"></div><div id="account-data"></div>`;
    resolve({ canDelete: true, reason: null });
    await pending;
    expect(document.querySelectorAll("#delete-form")).toHaveLength(0);
  });
});

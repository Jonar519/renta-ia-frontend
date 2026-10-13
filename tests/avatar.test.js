import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Foto de perfil (B12). jsdom no dibuja en canvas: el recorte real (arrastrar,
 * flechas, zoom, exportar a JPEG) se prueba en Chrome (e2e/avatar.spec.js).
 * Aquí: validaciones antes de recortar, subir/quitar desde Mi perfil, la foto
 * en el menú de la cuenta. La CSP: tests/csp.test.js.
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
vi.mock("../src/api/avatar.api.js", () => ({
  avatarApi: { upload: vi.fn(), remove: vi.fn() },
  avatarUrl: vi.fn(),
}));
vi.mock("../src/components/avatarCropper.js", async (original) => ({
  ...(await original()),
  cropAvatar: vi.fn(),
}));
vi.mock("../src/auth/session.js", () => ({ startSession: vi.fn(), logout: vi.fn() }));

const { usersApi } = await import("../src/api/users.api.js");
const { avatarApi, avatarUrl } = await import("../src/api/avatar.api.js");
const cropper = await import("../src/components/avatarCropper.js");
const { setAuth, clearAuth, getState } = await import("../src/state/store.js");
const { renderProfile } = await import("../src/views/profile.view.js");
const { paintAvatar } = await import("../src/components/userMenu.js");

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const app = () => document.getElementById("app");
const ME = { id: "u1", name: "Ana Contadora", email: "ana@example.com", role: "accountant", phone: null };
const pick = (file) => {
  const input = app().querySelector("#avatar-file");
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
};

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  setAuth("t", { ...ME, avatarUpdatedAt: null });
});
afterEach(() => {
  vi.clearAllMocks();
  clearAuth();
});

describe("antes de recortar", () => {
  const real = () => vi.importActual("../src/components/avatarCropper.js");

  it("rechaza otro tipo de archivo o una imagen de más de 10 MB, sin tocar el canvas", async () => {
    const { cropAvatar } = await real();
    const host = document.createElement("div");
    await expect(cropAvatar(host, new File(["GIF89a"], "a.gif", { type: "image/gif" }))).rejects.toThrow(/PNG o JPG/);
    const huge = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "a.png", { type: "image/png" });
    await expect(cropAvatar(host, huge)).rejects.toThrow(/10 MB/);
    expect(host.innerHTML).toBe("");
  });
});

describe("Mi perfil: foto", () => {
  it("elegir → recortar → subir: actualiza la sesión (el menú la muestra) y avisa", async () => {
    usersApi.me.mockResolvedValue({ ...ME, avatarUpdatedAt: null });
    const blob = new Blob(["jpeg"], { type: "image/jpeg" });
    cropper.cropAvatar.mockResolvedValue(blob);
    avatarApi.upload.mockResolvedValue({ avatarUpdatedAt: "2026-10-07T10:00:00.000Z" });
    await renderProfile(app());
    expect(app().querySelector("#avatar-choose").textContent).toBe("Elegir foto");
    expect(app().querySelector("#avatar-remove")).toBeNull();
    expect(app().querySelector("#profile-photo").textContent).toBe("AC"); // iniciales sin foto

    pick(new File(["x"], "foto.png", { type: "image/png" }));
    await flush();
    expect(cropper.cropAvatar).toHaveBeenCalledWith(app().querySelector("#avatar-cropper"), expect.any(File));
    expect(avatarApi.upload).toHaveBeenCalledWith(blob);
    expect(getState().user.avatarUpdatedAt).toBe("2026-10-07T10:00:00.000Z");
  });

  it("cancelar el recorte no sube nada; un error se muestra junto a la foto", async () => {
    usersApi.me.mockResolvedValue({ ...ME, avatarUpdatedAt: null });
    cropper.cropAvatar.mockResolvedValueOnce(null).mockRejectedValueOnce(new Error("La imagen es muy pequeña."));
    await renderProfile(app());
    pick(new File(["x"], "foto.png", { type: "image/png" }));
    await flush();
    expect(avatarApi.upload).not.toHaveBeenCalled();
    pick(new File(["x"], "foto.png", { type: "image/png" }));
    await flush();
    expect(app().querySelector("#avatar-error").textContent).toBe("La imagen es muy pequeña.");
  });

  it("quitar la foto la borra en la API y en la sesión local", async () => {
    setAuth("t", { ...ME, avatarUpdatedAt: "2026-10-07T10:00:00.000Z" });
    usersApi.me
      .mockResolvedValueOnce({ ...ME, avatarUpdatedAt: "2026-10-07T10:00:00.000Z" })
      .mockResolvedValue({ ...ME, avatarUpdatedAt: null });
    avatarUrl.mockResolvedValue("blob:foto");
    avatarApi.remove.mockResolvedValue(undefined);
    await renderProfile(app());
    expect(app().querySelector("#avatar-choose").textContent).toBe("Cambiar foto");
    app().querySelector("#avatar-remove").click();
    await flush();
    expect(avatarApi.remove).toHaveBeenCalled();
    expect(getState().user.avatarUpdatedAt).toBeNull();
  });
});

describe("la foto en el menú", () => {
  it("iniciales sin foto; con foto, la imagen (texto alternativo vacío: es decorativa)", async () => {
    const el = document.createElement("span");
    paintAvatar(el, { name: "Ana Contadora", avatarUpdatedAt: null });
    expect(el.textContent).toBe("AC");
    avatarUrl.mockResolvedValue("blob:foto-1");
    paintAvatar(el, { name: "Ana Contadora", avatarUpdatedAt: "v1" });
    await flush();
    const img = el.querySelector("img");
    expect([img.getAttribute("src"), img.alt]).toEqual(["blob:foto-1", ""]);
  });

  it("si la foto cambia mientras se descarga, no se pinta la vieja", async () => {
    const el = document.createElement("span");
    let resolveOld;
    avatarUrl.mockReturnValueOnce(new Promise((r) => (resolveOld = r))).mockResolvedValueOnce(null);
    paintAvatar(el, { name: "Ana Contadora", avatarUpdatedAt: "v1" });
    paintAvatar(el, { name: "Ana Contadora", avatarUpdatedAt: null });
    resolveOld("blob:vieja");
    await flush();
    expect(el.querySelector("img")).toBeNull();
    expect(el.textContent).toBe("AC");
  });
});

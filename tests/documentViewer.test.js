import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vista dividida I (B17): el visor del original (solo contador y asistente),
 * sus estados y la descarga sin visor del portal y del admin. pdf.js se
 * prueba en Chrome real (e2e/documentViewer.spec.js): aquí solo se comprueba
 * que una imagen NO lo pide.
 */

const pdfjsRequested = vi.fn();
vi.mock("pdfjs-dist/build/pdf.min.mjs?url", () => {
  pdfjsRequested("lib");
  return { default: "/assets/pdf.min.mjs" };
});
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => {
  pdfjsRequested("worker");
  return { default: "/assets/pdf.worker.min.mjs" };
});
vi.mock("../src/api/clients.api.js", () => ({ clientsApi: { getTaxConcepts: vi.fn() } }));
vi.mock("../src/api/documents.api.js", () => ({ documentsApi: { listByClient: vi.fn(), reprocess: vi.fn() } }));
vi.mock("../src/auth/session.js", () => ({ refreshSession: vi.fn() }));

const { clientsApi } = await import("../src/api/clients.api.js");
const { documentsApi } = await import("../src/api/documents.api.js");
const { refreshSession } = await import("../src/auth/session.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { openDocumentViewer } = await import("../src/views/clientDetail/documentViewer.js");
const { createDocumentsSection, documentsPanelHtml } = await import("../src/views/clientDetail/documents.section.js");

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const app = () => document.getElementById("app");
const DOC = {
  id: "d1",
  clientId: "cli",
  docType: "certificado_ingresos",
  originalName: "certificado <2025>.png",
  status: "processed",
  uploadedAt: "2026-10-01T10:00:00Z",
};
const fileResponse = (type, status = 200) =>
  new Response(status === 200 ? new Blob(["x"], { type }) : null, { status, headers: { "content-type": type } });

let revoked;
beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  vi.stubGlobal("CSS", { escape: (value) => value });
  // jsdom no implementa scrollIntoView.
  Element.prototype.scrollIntoView = vi.fn();
  revoked = [];
  URL.createObjectURL = vi.fn(() => "blob:archivo");
  URL.revokeObjectURL = vi.fn((url) => revoked.push(url));
  pdfjsRequested.mockClear();
});
afterEach(() => {
  clearAuth();
  vi.unstubAllGlobals();
});

describe("visor (contador y asistente)", () => {
  const fetchFile = vi.fn();
  const open = (onClose = vi.fn()) => openDocumentViewer(app(), DOC, { fetchFile, onClose });

  it("una imagen se muestra con <img> (blob:) y NO pide pdf.js", async () => {
    fetchFile.mockResolvedValue({ blob: new Blob(["x"]), type: "image/png" });
    open();
    expect(app().querySelector("[data-page-box]").getAttribute("aria-busy")).toBe("true");
    await flush();
    const img = app().querySelector(".viewer__page img");
    expect(img.getAttribute("src")).toBe("blob:archivo");
    expect(img.getAttribute("alt")).toBe("Documento original: certificado <2025>.png");
    expect(app().querySelector("[data-page-box]").hasAttribute("aria-busy")).toBe(false);
    expect(app().querySelector(".viewer__pdf-tools").hidden).toBe(true);
    const download = app().querySelector("[data-download]");
    expect(download.hidden).toBe(false);
    expect(download.getAttribute("download")).toBe(DOC.originalName);
    expect(pdfjsRequested).not.toHaveBeenCalled();
  });

  it("el nombre del archivo se escapa (no inyecta HTML)", async () => {
    fetchFile.mockResolvedValue({ blob: new Blob(["x"]), type: "image/png" });
    openDocumentViewer(app(), { ...DOC, originalName: '<img src=x onerror="alert(1)">.png' }, { fetchFile });
    await flush();
    expect(app().querySelector("#viewer-title").textContent).toBe('<img src=x onerror="alert(1)">.png');
    expect(app().querySelectorAll("img")).toHaveLength(1);
  });

  it("error: mensaje propio y Reintentar vuelve a pedir el archivo", async () => {
    fetchFile.mockRejectedValueOnce(new Error("El archivo original de este documento no está disponible."));
    open();
    await flush();
    expect(app().querySelector(".viewer__page").textContent).toContain("No se pudo mostrar el documento.");
    expect(app().querySelector(".viewer__page").textContent).toContain("no está disponible");
    expect(app().querySelector("[data-download]").hidden).toBe(true);
    fetchFile.mockResolvedValueOnce({ blob: new Blob(["x"]), type: "image/jpeg" });
    app().querySelector("[data-retry]").click();
    await flush();
    expect(fetchFile).toHaveBeenCalledTimes(2);
    expect(app().querySelector(".viewer__page img")).not.toBeNull();
  });

  it("un tipo que no se puede mostrar ofrece descargarlo", async () => {
    fetchFile.mockResolvedValue({ blob: new Blob(["x"]), type: "application/octet-stream" });
    open();
    await flush();
    expect(app().querySelector(".viewer__page").textContent).toContain("Descárgalo para abrirlo");
    expect(app().querySelector("[data-download]").hidden).toBe(false);
    expect(pdfjsRequested).not.toHaveBeenCalled();
  });

  it("Cerrar y Escape cierran, liberan el blob y avisan (para devolver el foco)", async () => {
    fetchFile.mockResolvedValue({ blob: new Blob(["x"]), type: "image/png" });
    const onClose = vi.fn();
    open(onClose);
    await flush();
    expect(document.activeElement.id).toBe("viewer-title");
    app().querySelector("[data-close]").click();
    expect(app().innerHTML).toBe("");
    expect(revoked).toEqual(["blob:archivo"]);
    expect(onClose).toHaveBeenCalledTimes(1);

    const onClose2 = vi.fn();
    open(onClose2);
    await flush();
    app()
      .querySelector("[data-page-box]")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(onClose2).toHaveBeenCalledTimes(1);
  });

  it("si se cierra mientras descarga, no pinta nada después", async () => {
    let resolve;
    fetchFile.mockReturnValue(new Promise((r) => (resolve = r)));
    const viewer = open();
    viewer.close();
    resolve({ blob: new Blob(["x"]), type: "image/png" });
    await flush();
    expect(app().innerHTML).toBe("");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

describe("Documentos: visor o Descargar según el rol", () => {
  async function mount(role) {
    setAuth("t", { id: "u1", name: "Ana", email: "a@x.co", role });
    clientsApi.getTaxConcepts.mockResolvedValue([]);
    documentsApi.listByClient.mockResolvedValue({ items: [DOC], nextCursor: null });
    app().innerHTML = documentsPanelHtml();
    const section = createDocumentsSection(app(), "cli", { signal: new AbortController().signal });
    await section.load();
    await flush();
  }
  const rowButtons = () => [...app().querySelectorAll(`tr[data-document-id="d1"] button`)].map((b) => b.textContent);

  it.each(["accountant", "assistant"])("%s ve «Ver original» y abre el visor", async (role) => {
    await mount(role);
    expect(rowButtons().some((t) => t.startsWith("Ver original"))).toBe(true);
    expect(rowButtons().some((t) => t.startsWith("Descargar"))).toBe(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fileResponse("image/png")))
    );
    app().querySelector("button[data-view-id]").click();
    await flush();
    expect(fetch.mock.calls[0][0]).toMatch(/\/api\/documents\/d1\/file$/);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe("Bearer t");
    expect(app().querySelector("#document-viewer .viewer__page img")).not.toBeNull();
    // Al cerrar, el foco vuelve al botón del documento, aunque la fila se haya
    // vuelto a pintar mientras el visor estaba abierto (terminó el análisis).
    const row = app().querySelector('tr[data-document-id="d1"]');
    row.replaceWith(row.cloneNode(true));
    app().querySelector("[data-close]").click();
    expect(document.activeElement.dataset.viewId).toBe("d1");
    expect(document.activeElement.isConnected).toBe(true);
  });

  it.each(["client", "admin"])("%s ve «Descargar», no el visor", async (role) => {
    await mount(role);
    expect(rowButtons().some((t) => t.startsWith("Descargar"))).toBe(true);
    expect(app().querySelector("button[data-view-id]")).toBeNull();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(fileResponse("application/pdf")))
    );
    const clicked = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      clicked.link = { href: this.href, download: this.download };
    });
    app().querySelector("button[data-download-id]").click();
    await flush();
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(clicked.link).toEqual({ href: "blob:archivo", download: DOC.originalName });
    expect(app().querySelector("#document-viewer").innerHTML).toBe("");
    expect(pdfjsRequested).not.toHaveBeenCalled();
  });

  it("Descargar: un 401 renueva la sesión una vez; un 404 se avisa", async () => {
    await mount("client");
    refreshSession.mockResolvedValue(true);
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValueOnce(fileResponse("", 401)).mockResolvedValueOnce(fileResponse("", 404))
    );
    app().querySelector("button[data-download-id]").click();
    await flush();
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(document.querySelector("#toast-root").textContent).toContain(
      "El archivo original de este documento no está disponible."
    );
    expect(app().querySelector("button[data-download-id]").disabled).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Vista dividida (B18, versión simplificada): con el original abierto, la
 * tabla de Conceptos que ya existe muestra solo los de ese documento, y se
 * revisan con el mismo formulario y el mismo endpoint de B16 (una sola forma
 * de editar un concepto). Al cerrar, vuelven todos, ya sincronizados. El
 * diseño lado a lado y el apilado en móvil se prueban en Chrome
 * (e2e/splitView.spec.js).
 */

vi.mock("../src/api/clients.api.js", () => ({ clientsApi: { getTaxConcepts: vi.fn(), reviewConcept: vi.fn() } }));
vi.mock("../src/api/documents.api.js", () => ({ documentsApi: { listByClient: vi.fn(), reprocess: vi.fn() } }));
vi.mock("../src/auth/session.js", () => ({ refreshSession: vi.fn() }));

const { clientsApi } = await import("../src/api/clients.api.js");
const { documentsApi } = await import("../src/api/documents.api.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { createDocumentsSection, documentsPanelHtml } = await import("../src/views/clientDetail/documents.section.js");

const flush = async () => {
  for (let i = 0; i < 15; i++) await new Promise((r) => setTimeout(r, 0));
};
const app = () => document.getElementById("app");
const conceptIds = () =>
  [...app().querySelectorAll("#concepts-table tr[data-concept-id]")].map((r) => r.dataset.conceptId);
const filterNote = () => app().querySelector("#concepts-filter");

const doc = (id, originalName) => ({
  id,
  clientId: "cli",
  docType: "income_certificate",
  originalName,
  status: "processed",
  uploadedAt: "2026-10-01T10:00:00Z",
});
const concept = (id, documentId, amount) => ({
  id,
  documentId,
  conceptType: "withholding",
  description: `Retención ${id}`,
  amount: String(amount),
  aiAmount: String(amount),
  periodYear: 2025,
  source: "ai",
  reviewed: false,
  reviewedAt: null,
  reviewer: null,
});
const CERT = doc("d1", "certificado.pdf");
const EXTRACT = doc("d2", "extracto.png");
const EMPTY = doc("d3", "sin-conceptos.png");

async function mount(role = "accountant") {
  setAuth("t", { id: "u1", name: "Ana", email: "a@x.co", role });
  clientsApi.getTaxConcepts.mockResolvedValue([
    concept("c1", "d1", 1500000),
    concept("c2", "d2", 200000),
    concept("c3", "d1", 300000),
  ]);
  documentsApi.listByClient.mockResolvedValue({ items: [CERT, EXTRACT, EMPTY], nextCursor: null });
  app().innerHTML = documentsPanelHtml();
  const section = createDocumentsSection(app(), "cli", { signal: new AbortController().signal });
  await section.load();
  await flush();
}
async function openOriginal(docId) {
  app().querySelector(`button[data-view-id="${docId}"]`).click();
  await flush();
}

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  vi.stubGlobal("CSS", { escape: (value) => value });
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(new Blob(["x"], { type: "image/png" }), { headers: { "content-type": "image/png" } })
      )
    )
  );
  Element.prototype.scrollIntoView = vi.fn();
  URL.createObjectURL = vi.fn(() => "blob:archivo");
  URL.revokeObjectURL = vi.fn();
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
});
afterEach(() => {
  clearAuth();
  vi.unstubAllGlobals();
});

describe("vista dividida", () => {
  it("el visor y los conceptos comparten el contenedor de la vista dividida, en ese orden", async () => {
    await mount();
    const split = app().querySelector(".split");
    expect([...split.children].map((el) => el.id || el.querySelector("h2")?.textContent)).toEqual([
      "document-viewer",
      "Conceptos tributarios extraídos",
    ]);
  });

  it("al abrir el original, la tabla muestra solo sus conceptos; al cerrarlo, vuelven todos", async () => {
    await mount();
    expect(conceptIds()).toEqual(["c1", "c2", "c3"]);
    expect(filterNote().hidden).toBe(true);

    await openOriginal("d1");
    expect(conceptIds()).toEqual(["c1", "c3"]);
    expect(filterNote().hidden).toBe(false);
    expect(filterNote().textContent).toContain("Conceptos de certificado.pdf: 2 de 3.");
    // El foco va al título del visor (orden: visor → conceptos).
    expect(document.activeElement.id).toBe("viewer-title");

    // Otro documento: cambia el filtro.
    await openOriginal("d2");
    expect(conceptIds()).toEqual(["c2"]);
    expect(filterNote().textContent).toContain("extracto.png: 1 de 3");

    app().querySelector("[data-close]").click();
    await flush();
    expect(conceptIds()).toEqual(["c1", "c2", "c3"]);
    expect(filterNote().hidden).toBe(true);
    expect(document.activeElement.dataset.viewId).toBe("d2");
  });

  it("un documento sin conceptos muestra su propio estado vacío", async () => {
    await mount();
    await openOriginal("d3");
    expect(conceptIds()).toEqual([]);
    expect(app().querySelector("#concepts-table").textContent).toContain(
      "Este documento no tiene conceptos extraídos."
    );
    expect(filterNote().textContent).toContain("0 de 3");
  });

  it("se revisa con el formulario y el endpoint de B16; al cerrar, la tabla principal ya está sincronizada", async () => {
    await mount();
    await openOriginal("d1");
    clientsApi.reviewConcept.mockResolvedValue({
      ...concept("c1", "d1", 1450000),
      source: "person",
      aiAmount: "1500000",
      reviewed: true,
      reviewer: { name: "Ana" },
    });

    const row = app().querySelector('tr[data-concept-id="c1"]');
    row.querySelector("button[data-review-id]").click();
    await flush();
    const input = row.querySelector("input[name=amount]");
    expect(document.activeElement).toBe(input);
    input.value = "1.450.000";
    row.querySelector("form").requestSubmit();
    await flush();

    expect(clientsApi.reviewConcept).toHaveBeenCalledTimes(1);
    expect(clientsApi.reviewConcept).toHaveBeenCalledWith("cli", "c1", 1450000);
    const reviewed = () => app().querySelector('tr[data-concept-id="c1"]');
    expect(reviewed().textContent).toContain("Revisado");
    expect(document.activeElement.dataset.reviewId).toBe("c1");

    app().querySelector("[data-close]").click();
    await flush();
    expect(conceptIds()).toEqual(["c1", "c2", "c3"]);
    expect(reviewed().textContent).toContain("Revisado");
    expect(reviewed().textContent).toContain("$1.450.000");
    // Los totales usan el monto revisado (1.450.000 + 200.000 + 300.000).
    expect(app().querySelector("#concepts-totals").textContent).toContain("$1.950.000");
  });

  it.each(["client", "admin"])("%s: sin visor, sin vista dividida (la tabla nunca se filtra)", async (role) => {
    await mount(role);
    expect(app().querySelector("button[data-view-id]")).toBeNull();
    app().querySelector("button[data-download-id]").click();
    await flush();
    expect(app().querySelector("#document-viewer").innerHTML).toBe("");
    expect(conceptIds()).toEqual(["c1", "c2", "c3"]);
    expect(filterNote().hidden).toBe(true);
  });
});

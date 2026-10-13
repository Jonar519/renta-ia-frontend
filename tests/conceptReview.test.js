import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Revisión de conceptos (B16) en la pestaña Documentos: badge "Extraído por IA ·
 * sin revisar" (D5), revisar (confirmar o corregir) y el estado que queda;
 * el portal ve solo revisado/sin revisar; D6 al reprocesar. En Chrome real:
 * e2e/conceptReview.spec.js.
 */

vi.mock("../src/api/clients.api.js", () => ({ clientsApi: { getTaxConcepts: vi.fn(), reviewConcept: vi.fn() } }));
vi.mock("../src/api/documents.api.js", () => ({ documentsApi: { listByClient: vi.fn(), reprocess: vi.fn() } }));

const { clientsApi } = await import("../src/api/clients.api.js");
const { documentsApi } = await import("../src/api/documents.api.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { createDocumentsSection, documentsPanelHtml } = await import("../src/views/clientDetail/documents.section.js");
const { parseAmount } = await import("../src/views/clientDetail/conceptReview.js");

const flush = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};
const app = () => document.getElementById("app");
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);
const row = (id) => app().querySelector(`tr[data-concept-id="${id}"]`);
const reviewCell = (id) => row(id).querySelector('td[data-label="Revisión"]');

const AI = {
  id: "c1",
  conceptType: "withholding",
  description: "Retención",
  amount: "1500000",
  periodYear: 2025,
  reviewed: false,
  aiAmount: "1500000",
  source: "ai",
  reviewedAt: null,
  reviewer: null,
};
const REVIEWED = {
  ...AI,
  id: "c2",
  amount: "1400000",
  source: "person",
  reviewed: true,
  reviewedAt: "2026-10-09T10:00:00Z",
  reviewer: { name: "Ana" },
};
// Lo que recibe el portal: solo si está revisado.
const PORTAL = {
  id: "c3",
  conceptType: "withholding",
  description: "Retención",
  amount: "1400000",
  periodYear: 2025,
  reviewed: true,
};

async function mount(concepts, role = "accountant") {
  setAuth("t", { id: "u1", name: "Ana", email: "a@x.co", role });
  clientsApi.getTaxConcepts.mockResolvedValue(concepts);
  documentsApi.listByClient.mockResolvedValue({ items: [], nextCursor: null });
  app().innerHTML = documentsPanelHtml();
  const section = createDocumentsSection(app(), "cli", { signal: new AbortController().signal });
  await section.load();
  await flush();
  return section;
}

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
  // jsdom no tiene CSS.escape (Chrome sí); los ids de prueba no necesitan escaparse.
  vi.stubGlobal("CSS", { escape: (value) => value });
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearAuth();
});

describe("montos en formato colombiano", () => {
  it.each([
    ["1.450.000,50", 1450000.5],
    ["1450000.5", 1450000.5],
    ["$ 1.500.000", 1500000],
    ["1.500", 1500],
    ["0", 0],
    ["-5", null],
    ["10,123", null],
    ["abc", null],
    ["", null],
  ])("%s → %s", (text, value) => expect(parseAmount(text)).toBe(value));
});

describe("badge y revisión", () => {
  it("sin revisar: badge violeta 'Extraído por IA · sin revisar' y 'Revisar'; el total dice cuántos faltan", async () => {
    await mount([AI, REVIEWED]);
    const badge = reviewCell("c1").querySelector(".badge");
    expect(badge.textContent).toBe("Extraído por IA · sin revisar");
    expect(badge.classList.contains("badge--ai")).toBe(true);
    expect(reviewCell("c1").querySelector("button").textContent).toContain("Revisar");
    expect(app().querySelector("#concepts-totals").textContent).toContain(
      "Incluye 1 concepto extraído por IA sin revisar."
    );
  });

  it("revisado y corregido: 'Revisado', quién, y lo que leyó la IA (al equipo del contador)", async () => {
    await mount([REVIEWED]);
    const cell = reviewCell("c2");
    expect(cell.querySelector(".badge").textContent).toBe("Revisado");
    expect(cell.querySelector(".badge--ai")).toBeNull();
    expect(cell.textContent).toContain("por Ana");
    expect(cell.textContent).toMatch(/Corregido · la IA leyó \$\s?1\.500\.000/);
    expect(cell.querySelector("button").textContent).toContain("Cambiar");
  });

  it("revisar: confirma con el monto escrito, el badge se va para siempre en la fila y los totales se recalculan", async () => {
    await mount([AI]);
    clientsApi.reviewConcept.mockResolvedValue({
      ...AI,
      amount: "1450000.5",
      source: "person",
      reviewed: true,
      reviewer: { name: "Ana" },
    });
    reviewCell("c1").querySelector("button").click();
    await flush();
    const input = reviewCell("c1").querySelector("input");
    expect(document.activeElement).toBe(input);
    expect(reviewCell("c1").textContent).toMatch(/La IA leyó \$\s?1\.500\.000/);
    input.value = "1.450.000,50";
    reviewCell("c1")
      .querySelector("form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(clientsApi.reviewConcept).toHaveBeenCalledWith("cli", "c1", 1450000.5);
    const badge = reviewCell("c1").querySelector(".badge");
    expect(badge.textContent).toBe("Revisado");
    // La única micro-interacción del badge: una vez, al quedar revisado.
    expect(badge.classList.contains("badge--reviewed-now")).toBe(true);
    expect(app().querySelector(".badge--ai")).toBeNull();
    expect(app().querySelector("#concepts-totals").textContent).not.toContain("sin revisar");
    expect(document.activeElement.textContent).toContain("Cambiar");
    expect(toasts()).toContain("Concepto revisado.");
  });

  it("un monto inválido no llama a la API; cancelar deja la fila como estaba y devuelve el foco", async () => {
    await mount([AI]);
    reviewCell("c1").querySelector("button").click();
    await flush();
    reviewCell("c1").querySelector("input").value = "-3";
    reviewCell("c1")
      .querySelector("form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    expect(reviewCell("c1").querySelector("[role=alert]").textContent).toContain("monto válido");
    expect(clientsApi.reviewConcept).not.toHaveBeenCalled();
    reviewCell("c1").querySelector("[data-review-cancel]").click();
    expect(reviewCell("c1").querySelector(".badge--ai")).not.toBeNull();
    expect(document.activeElement.textContent).toContain("Revisar");
  });

  it("si la API falla, el error queda junto al campo y no se marca revisado", async () => {
    await mount([AI]);
    clientsApi.reviewConcept.mockRejectedValue(new Error("Concepto no encontrado"));
    reviewCell("c1").querySelector("button").click();
    await flush();
    reviewCell("c1")
      .querySelector("form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();
    expect(reviewCell("c1").querySelector("[role=alert]").textContent).toBe("Concepto no encontrado");
    expect(reviewCell("c1").querySelector("form")).not.toBeNull();
  });
});

describe("portal (solo lectura)", () => {
  it("ve solo 'Revisado' o el badge de IA: sin botón, sin quién ni lo que leyó la IA", async () => {
    await mount([PORTAL, { ...PORTAL, id: "c4", reviewed: false }], "client");
    expect(reviewCell("c3").textContent.trim()).toBe("Revisado");
    expect(reviewCell("c4").textContent.trim()).toBe("Extraído por IA · sin revisar");
    expect(app().querySelector("button[data-review-id]")).toBeNull();
  });
});

describe("D6: reprocesar con conceptos revisados", () => {
  const DOC = {
    id: "d1",
    originalName: "cert.pdf",
    docType: "income_certificate",
    status: "processed",
    errorMessage: "Advertencia",
    uploadedAt: "2026-10-09T10:00:00Z",
  };
  const conflict = () =>
    Object.assign(new Error("Este documento tiene 1 concepto revisado. Reprocesarlo descarta esa revisión."), {
      code: "reviewed_concepts",
      status: 409,
    });

  async function mountWithDoc() {
    setAuth("t", { id: "u1", name: "Ana", email: "a@x.co", role: "accountant" });
    clientsApi.getTaxConcepts.mockResolvedValue([REVIEWED]);
    documentsApi.listByClient.mockResolvedValue({ items: [DOC], nextCursor: null });
    app().innerHTML = documentsPanelHtml();
    const section = createDocumentsSection(app(), "cli", { signal: new AbortController().signal });
    await section.load();
    await flush();
  }
  const clickReprocess = async () => {
    app().querySelector("button[data-reprocess-id]").click();
    await flush();
  };

  it("pide confirmación explícita; 'Volver' no reprocesa ni descarta nada", async () => {
    await mountWithDoc();
    documentsApi.reprocess.mockRejectedValueOnce(conflict());
    await clickReprocess();
    const dialog = document.getElementById("discard-reviews-dialog");
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("1 concepto revisado");
    dialog.querySelector('[data-dialog="back"]').click();
    await flush();
    expect(documentsApi.reprocess).toHaveBeenCalledTimes(1);
    expect(documentsApi.reprocess).toHaveBeenCalledWith("d1");
    expect(document.getElementById("discard-reviews-dialog")).toBeNull();
    expect(document.activeElement.dataset.reprocessId).toBe("d1");
  });

  it("confirmar 'Descartar revisiones y reprocesar' reintenta con la confirmación", async () => {
    await mountWithDoc();
    documentsApi.reprocess.mockRejectedValueOnce(conflict()).mockResolvedValueOnce({ ...DOC, status: "uploaded" });
    await clickReprocess();
    document.querySelector('#discard-reviews-dialog [data-dialog="confirm"]').click();
    await flush();
    expect(documentsApi.reprocess).toHaveBeenLastCalledWith("d1", { discardReviews: true });
    expect(toasts().join(" ")).toContain("Análisis reencolado");
  });
});

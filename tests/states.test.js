import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Estados explícitos de las vistas (docs/ui-states.md): skeleton, error con
 * "Reintentar" que NO recarga la página, vacío orientativo, confirmación de
 * acciones y toasts de conectividad.
 */

vi.mock("../src/api/ai.api.js", () => ({ aiApi: { chat: vi.fn() } }));
vi.mock("../src/api/clients.api.js", () => ({ clientsApi: { summary: vi.fn() } }));

const { aiApi } = await import("../src/api/ai.api.js");
const { clientsApi } = await import("../src/api/clients.api.js");
const states = await import("../src/components/states.js");
const { createPagedList } = await import("../src/components/pagedList.js");
const { createChatSection, chatPanelHtml } = await import("../src/views/clientDetail/chat.section.js");
const { createSummarySection, summaryPanelHtml } = await import("../src/views/clientDetail/summary.section.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { emptyClientsHtml } = await import("../src/views/dashboard.view.js");

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0)));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearAuth();
  document.body.innerHTML = "";
});

describe("components/states.js", () => {
  it("skeleton: filas aria-hidden, texto oculto para lectores, sin estilos en línea ni animación", () => {
    const html = states.skeletonRowsHtml(3, { rows: 2, label: "Cargando clientes…" });
    document.body.innerHTML = `<table><tbody>${html}</tbody></table>`;
    const rows = document.querySelectorAll("tr.skeleton-row");
    expect(rows).toHaveLength(2);
    rows.forEach((row) => expect(row.getAttribute("aria-hidden")).toBe("true"));
    expect(document.querySelector(".visually-hidden").textContent).toBe("Cargando clientes…");
    // La CSP (style-src 'self') bloquearía un style="…"; y D4: skeleton estático.
    expect(html).not.toMatch(/style=/);
    expect(html).not.toMatch(/ai-processing|animation/);
    expect(states.skeletonItemsHtml()).not.toMatch(/style=/);
    expect(states.skeletonBlockHtml()).not.toMatch(/style=/);
  });

  it("error: escapa el mensaje y trae un botón Reintentar", () => {
    document.body.innerHTML = states.errorStateHtml("<img src=x onerror=alert(1)>");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector(".state__message").textContent).toBe("<img src=x onerror=alert(1)>");
    const button = document.querySelector("button[data-retry]");
    expect(button.textContent).toBe("Reintentar");
    expect(button.type).toBe("button");
  });

  it("vacío: título y orientación, sin botón de reintento", () => {
    document.body.innerHTML = states.emptyStateHtml("No hay nada.", "Haz esto para empezar.");
    expect(document.querySelector(".state__title").textContent).toBe("No hay nada.");
    expect(document.querySelector(".state__message").textContent).toBe("Haz esto para empezar.");
    expect(document.querySelector("[data-retry]")).toBeNull();
  });

  it("setPending deshabilita, cambia el texto y restaura", () => {
    document.body.innerHTML = `<button>Guardar</button>`;
    const button = document.querySelector("button");
    const done = states.setPending(button, "Guardando…");
    expect([button.disabled, button.textContent, button.getAttribute("aria-busy")]).toEqual([
      true,
      "Guardando…",
      "true",
    ]);
    done();
    expect([button.disabled, button.textContent, button.hasAttribute("aria-busy")]).toEqual([false, "Guardar", false]);
  });
});

describe("createPagedList: estados", () => {
  function setup(fetchPage) {
    document.body.innerHTML = `<table><tbody id="list"></tbody></table><div><button id="more" hidden>Cargar más</button></div><p id="status"></p>`;
    const list = createPagedList({
      container: document.getElementById("list"),
      moreButton: document.getElementById("more"),
      status: document.getElementById("status"),
      fetchPage,
      renderItem: (item) => `<tr data-id="${item.id}"><td>${item.id}</td></tr>`,
      loadingHtml: states.skeletonRowsHtml(1),
      emptyHtml: states.inRow(1, states.emptyStateHtml("vacío")),
      errorHtml: (message) => states.inRow(1, states.errorStateHtml(message)),
      itemLabel: "ítems",
    });
    return list;
  }

  it("muestra el skeleton y aria-busy mientras carga la primera página", async () => {
    let resolve;
    const list = setup(() => new Promise((r) => (resolve = r)));
    const pending = list.reload();
    expect(document.querySelector(".skeleton-row")).not.toBeNull();
    expect(document.querySelector("table").getAttribute("aria-busy")).toBe("true");
    resolve({ items: [{ id: "a" }], nextCursor: null });
    await pending;
    expect(document.querySelector(".skeleton-row")).toBeNull();
    expect(document.querySelector("table").hasAttribute("aria-busy")).toBe(false);
  });

  it("al recargar una lista con datos no vuelve al skeleton (sin parpadeo)", async () => {
    let resolve;
    const fetchPage = vi.fn().mockResolvedValueOnce({ items: [{ id: "a" }], nextCursor: null });
    const list = setup(fetchPage);
    await list.reload();
    fetchPage.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const pending = list.reload();
    expect(document.querySelector(".skeleton-row")).toBeNull();
    expect(document.querySelector('[data-id="a"]')).not.toBeNull();
    resolve({ items: [{ id: "b" }], nextCursor: null });
    await pending;
  });

  it("error → Reintentar vuelve a pedir SOLO la lista y la pinta, sin recargar la página", async () => {
    const href = window.location.href;
    const fetchPage = vi
      .fn()
      .mockRejectedValueOnce(new Error("El servidor tuvo un problema (500)."))
      .mockResolvedValueOnce({ items: [{ id: "a" }], nextCursor: null });
    const list = setup(fetchPage);
    await list.reload();
    expect(document.querySelector(".state--error .state__message").textContent).toBe(
      "El servidor tuvo un problema (500)."
    );

    document.querySelector("[data-retry]").click();
    await flush();
    await flush();
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(document.querySelector('[data-id="a"]')).not.toBeNull();
    expect(window.location.href).toBe(href);
  });

  it("error en 'Cargar más': mensaje VISIBLE y el botón pasa a 'Reintentar'", async () => {
    const fetchPage = vi
      .fn()
      .mockResolvedValueOnce({ items: [{ id: "a" }], nextCursor: "c1" })
      .mockRejectedValueOnce(new Error("Sin respuesta"))
      .mockResolvedValueOnce({ items: [{ id: "b" }], nextCursor: null });
    const list = setup(fetchPage);
    await list.reload();
    await list.loadMore();
    const error = document.querySelector(".load-more__error");
    expect(error.hidden).toBe(false);
    expect(error.textContent).toBe("No se pudieron cargar más ítems: Sin respuesta");
    const more = document.getElementById("more");
    expect([more.hidden, more.textContent]).toEqual([false, "Reintentar"]);

    await list.loadMore();
    expect(error.hidden).toBe(true);
    expect(document.querySelector('[data-id="b"]')).not.toBeNull();
    expect(more.textContent).toBe("Cargar más");
  });
});

describe("estado vacío del panel de clientes según el rol", () => {
  const text = () => {
    document.body.innerHTML = emptyClientsHtml();
    return document.body.textContent;
  };

  it("solo quien puede crear clientes recibe la indicación de crearlos", () => {
    setAuth("t", { id: "1", role: "accountant" });
    expect(text()).toContain("Nuevo cliente");
    setAuth("t", { id: "2", role: "assistant" });
    expect(text()).not.toContain("Nuevo cliente");
    expect(text()).toContain("contador al que apoyas");
    setAuth("t", { id: "3", role: "client" });
    expect(text()).not.toContain("Nuevo cliente");
    expect(text()).toContain("Tu expediente");
  });
});

describe("chat: error con Reintentar en la misma burbuja", () => {
  it("reintenta la MISMA pregunta y muestra la respuesta", async () => {
    document.body.innerHTML = chatPanelHtml();
    createChatSection(document.body, "cliente-1");
    aiApi.chat.mockRejectedValueOnce(new Error("Tiempo de espera agotado")).mockResolvedValueOnce({ answer: "85 M" });

    const form = document.getElementById("chat-form");
    form.elements.question.value = "¿Ingreso bruto?";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    await flush();

    const bubbles = () => [...document.querySelectorAll(".chat-message--assistant .chat-bubble")];
    expect(bubbles()).toHaveLength(1);
    expect(bubbles()[0].textContent).toContain("No se pudo responder: Tiempo de espera agotado");
    expect(bubbles()[0].classList.contains("ai-processing")).toBe(false);

    bubbles()[0].querySelector("button").click();
    await flush();
    expect(aiApi.chat).toHaveBeenLastCalledWith("cliente-1", "¿Ingreso bruto?");
    expect(bubbles()).toHaveLength(1);
    expect(bubbles()[0].textContent).toBe("85 M");
    expect(document.querySelector(".chat-message--error")).toBeNull();
  });

  it("mientras espera, la burbuja usa el indicador 'procesando con IA'", async () => {
    document.body.innerHTML = chatPanelHtml();
    createChatSection(document.body, "cliente-1");
    let resolve;
    aiApi.chat.mockImplementationOnce(() => new Promise((r) => (resolve = r)));
    const form = document.getElementById("chat-form");
    form.elements.question.value = "¿Retenciones?";
    form.dispatchEvent(new Event("submit", { cancelable: true }));
    expect(document.querySelector(".chat-message--pending .chat-bubble.ai-processing")).not.toBeNull();
    resolve({ answer: "ok" });
    await flush();
    expect(document.querySelector(".ai-processing")).toBeNull();
  });
});

describe("resumen: estado inicial, skeleton y Reintentar", () => {
  it("orienta antes de generar, muestra skeleton y reintenta el mismo envío", async () => {
    document.body.innerHTML = summaryPanelHtml();
    const result = document.getElementById("summary-result");
    expect(result.textContent).toContain("Aún no has generado un resumen.");

    createSummarySection(document.body, "cliente-1");
    let reject;
    clientsApi.summary.mockImplementationOnce(() => new Promise((_, r) => (reject = r)));
    const form = document.getElementById("summary-form");
    form.requestSubmit();
    expect(result.querySelector(".skeleton-block")).not.toBeNull();
    expect(document.getElementById("summary-btn").classList.contains("ai-processing")).toBe(true);

    reject(new Error("Límite de resúmenes"));
    await flush();
    expect(result.querySelector(".state--error").textContent).toContain("Límite de resúmenes");
    expect(document.getElementById("summary-btn").classList.contains("ai-processing")).toBe(false);

    clientsApi.summary.mockResolvedValueOnce({
      periodYear: 2025,
      availableYears: [2025],
      totals: { grossIncome: 1, pensionContribution: 0, healthContribution: 0, deductions: 0, withholding: 0 },
      estimate: null,
      text: "Texto",
      disclaimer: "Orientativo",
    });
    result.querySelector("[data-retry]").click();
    await flush();
    expect(clientsApi.summary).toHaveBeenCalledTimes(2);
    expect(result.querySelector(".summary__text").textContent).toBe("Texto");
  });
});

describe("toasts de conectividad", () => {
  it("avisan al perder y al recuperar la conexión, no al cargar la página", async () => {
    vi.resetModules();
    document.body.innerHTML = `<div id="toast-root"></div>`;
    const connectivity = await import("../src/offline/connectivity.js");
    const banner = await import("../src/components/connectivityBanner.js");
    connectivity.setOnline(true);
    banner.startConnectivityBanner();
    const toasts = () =>
      [...document.querySelectorAll("#toast-root .toast")].map((t) => [t.dataset.type, t.textContent]);
    expect(toasts()).toEqual([]);

    connectivity.setOnline(false);
    expect(toasts()).toEqual([["warning", banner.LOST_MESSAGE]]);
    // Mismo estado otra vez: sin toast repetido.
    connectivity.reportOfflineData(Date.now());
    expect(toasts()).toHaveLength(1);

    connectivity.setOnline(true);
    expect(toasts()[1]).toEqual(["success", banner.RESTORED_MESSAGE]);
  });
});

describe("controles que necesitan red, sin conexión", () => {
  it("quedan aria-disabled (también los que se pintan después) y se liberan al volver la red", async () => {
    vi.resetModules();
    document.body.innerHTML = `<div id="toast-root"></div><button id="a" data-requires-network>Subir</button>
      <form data-requires-network><button id="b" type="submit">Guardar</button></form><button id="c">Libre</button>`;
    const connectivity = await import("../src/offline/connectivity.js");
    const banner = await import("../src/components/connectivityBanner.js");
    connectivity.setOnline(true);
    banner.startConnectivityBanner();
    const disabled = () => [...document.querySelectorAll("[aria-disabled=true]")].map((el) => el.id);

    connectivity.setOnline(false);
    expect(disabled()).toEqual(["a", "b"]);
    const late = document.createElement("button");
    late.id = "d";
    late.dataset.requiresNetwork = "";
    document.body.append(late);
    await flush();
    expect(disabled()).toEqual(["a", "b", "d"]);

    connectivity.setOnline(true);
    expect(disabled()).toEqual([]);
  });
});

describe("conectividad: una respuesta tardía no anula el 'sin conexión' del navegador", () => {
  it("con navigator.onLine === false, reportNetworkOk no vuelve a marcar en línea", async () => {
    vi.resetModules();
    const connectivity = await import("../src/offline/connectivity.js");
    const onLine = vi.spyOn(navigator, "onLine", "get");
    onLine.mockReturnValue(false);
    connectivity.setOnline(false);
    connectivity.reportNetworkOk(); // respuesta que salió antes del corte
    expect(connectivity.getConnectivity().online).toBe(false);

    onLine.mockReturnValue(true);
    connectivity.reportNetworkOk();
    expect(connectivity.getConnectivity().online).toBe(true);
    onLine.mockRestore();
  });
});

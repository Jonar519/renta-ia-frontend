import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Densidad de las tablas (B15): selector Cómoda/Compacta, preferencia de la
 * cuenta (llega con la sesión, se guarda con PATCH /api/users/me) y tablas
 * en tarjetas en móvil (cada celda con su data-label). En Chrome real:
 * e2e/density.spec.js.
 */

vi.mock("../src/api/http.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, http: { ...actual.http, patch: vi.fn() } };
});
vi.mock("../src/api/clients.api.js", () => ({ clientsApi: { list: vi.fn(), create: vi.fn() } }));

const { http } = await import("../src/api/http.js");
const { clientsApi } = await import("../src/api/clients.api.js");
const { setAuth, clearAuth, getState } = await import("../src/state/store.js");
const { applyDensity, bindDensityToggles, densityToggleHtml } = await import("../src/components/densityToggle.js");
const { renderDashboard } = await import("../src/views/dashboard.view.js");

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const login = (tableDensity) =>
  setAuth("token", { id: "u1", name: "Ana", email: "ana@example.com", role: "accountant", tableDensity });
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);
const radios = (value) => [...document.querySelectorAll(`.density input[value="${value}"]`)];

/** Dos selectores en la página, como si hubiera dos tablas. */
function mountTwo() {
  document.getElementById("app").innerHTML =
    `<div id="a">${densityToggleHtml()}</div><div id="b">${densityToggleHtml()}</div>`;
  bindDensityToggles(document.getElementById("app"));
}
const choose = (value, which = "#a") => {
  const input = document.querySelector(`${which} .density input[value="${value}"]`);
  input.checked = true;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  delete document.documentElement.dataset.density;
  vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  clearAuth();
});

describe("selector de densidad", () => {
  it("es un grupo de radios con leyenda, marcado según la preferencia de la cuenta", () => {
    login("compact");
    mountTwo();
    const fieldset = document.querySelector("#a fieldset.density");
    expect(fieldset.querySelector("legend").textContent).toBe("Densidad de la tabla");
    expect([...fieldset.querySelectorAll("label")].map((l) => l.textContent.trim())).toEqual(["Cómoda", "Compacta"]);
    expect(radios("compact").every((r) => r.checked)).toBe(true);
    // Cada selector es su propio grupo (las flechas no saltan de una tabla a otra).
    const names = [...document.querySelectorAll(".density input")].map((i) => i.name);
    expect(new Set(names).size).toBe(2);
  });

  it("aplica la preferencia a la página (data-density en <html>); sin preferencia, cómoda", () => {
    login(undefined);
    applyDensity();
    expect(document.documentElement.dataset.density).toBe("comfortable");
    login("compact");
    applyDensity();
    expect(document.documentElement.dataset.density).toBe("compact");
  });

  it("cambiar: se ve al instante en TODAS las tablas, queda en la sesión y se guarda en la cuenta", async () => {
    login("comfortable");
    mountTwo();
    http.patch.mockResolvedValue({});
    choose("compact");
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(radios("compact").every((r) => r.checked)).toBe(true); // también el otro selector
    expect(getState().user.tableDensity).toBe("compact");
    await flush();
    expect(http.patch).toHaveBeenCalledWith("/api/users/me", { tableDensity: "compact" });
  });

  it("si no se puede guardar, vuelve a la anterior y avisa", async () => {
    login("comfortable");
    mountTwo();
    http.patch.mockRejectedValue(new Error("Sin conexión: esta acción necesita internet."));
    choose("compact");
    await flush();
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(radios("comfortable").every((r) => r.checked)).toBe(true);
    expect(getState().user.tableDensity).toBe("comfortable");
    expect(toasts().join(" ")).toContain("Sin conexión");
  });

  it("dos cambios rápidos: si el primero falla después de guardarse el segundo, no lo pisa", async () => {
    login("comfortable");
    mountTwo();
    let failFirst;
    http.patch.mockReturnValueOnce(new Promise((_, reject) => (failFirst = reject))).mockResolvedValueOnce({});
    choose("compact");
    choose("comfortable", "#b");
    await flush();
    failFirst(new Error("falló"));
    await flush();
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(toasts()).toEqual([]);
  });

  it("si el usuario de la sesión llega después (al recuperarla del servidor), selectores y página se actualizan", () => {
    login(undefined); // pista local, sin la preferencia todavía
    mountTwo();
    expect(document.documentElement.dataset.density).toBe("comfortable");
    login("compact"); // llega el usuario real
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(radios("compact").every((r) => r.checked)).toBe(true);
  });

  it("elegir la que ya está no guarda nada", async () => {
    login("compact");
    mountTwo();
    choose("compact");
    await flush();
    expect(http.patch).not.toHaveBeenCalled();
  });
});

describe("Clientes", () => {
  it("lleva el selector y cada celda su encabezado (data-label) para las tarjetas en móvil", async () => {
    login("comfortable");
    clientsApi.list.mockResolvedValue({
      items: [
        { id: "c1", fullName: "Juan Pérez", documentNumber: "CC-1", email: null, createdAt: "2026-10-01T00:00:00Z" },
      ],
      nextCursor: null,
    });
    await renderDashboard(document.getElementById("app"));
    await flush();
    expect(document.querySelector(".table-toolbar fieldset.density")).not.toBeNull();
    const table = document.querySelector("table.table--stack");
    const labels = [...table.querySelectorAll("tbody tr:not(.skeleton-row) td")].map((td) => td.dataset.label ?? null);
    expect(labels).toEqual(["Cliente", "Documento", "Correo", "Creado", null]);
    // Los encabezados de las columnas y los data-label dicen lo mismo.
    const headers = [...table.querySelectorAll("thead th")].map((th) => th.textContent.trim()).slice(0, 4);
    expect(headers).toEqual(["Cliente", "Documento", "Correo", "Creado"]);
  });
});

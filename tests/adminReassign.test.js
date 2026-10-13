import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Reasignar clientes" en Usuarios (admin): elegir origen y destino,
 * confirmar, y los estados de carga, error y vacío. En Chrome real:
 * e2e/reassign.spec.js.
 */

vi.mock("../src/api/admin.api.js", () => ({ adminApi: { accountants: vi.fn(), reassignClients: vi.fn() } }));

const { adminApi } = await import("../src/api/admin.api.js");
const { mountReassign } = await import("../src/views/adminReassign.js");

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0));
};
const slot = () => document.getElementById("slot");
const q = (sel) => slot().querySelector(sel);
const toasts = () => [...document.querySelectorAll("#toast-root .toast")].map((t) => t.textContent);
const submit = () => q("#reassign-form").dispatchEvent(new Event("submit", { cancelable: true }));

const ANA = { id: "a", name: "Ana", email: "ana@x.co", clientCount: 3 };
const LUIS = { id: "l", name: "Luis", email: "luis@x.co", clientCount: 0 };
const EVA = { id: "e", name: "Eva", email: "eva@x.co", clientCount: 1 };

async function mount(items = [ANA, LUIS, EVA]) {
  adminApi.accountants.mockResolvedValue({ items });
  await mountReassign(slot());
  await flush();
}
const choose = (from, to) => {
  q("select[name=from]").value = from;
  q("select[name=to]").value = to;
};

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="slot"></div>`;
  HTMLDialogElement.prototype.showModal ??= function () {
    this.open = true;
  };
  HTMLDialogElement.prototype.close ??= function () {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});
afterEach(() => vi.clearAllMocks());

describe("reasignar clientes", () => {
  it("origen: solo contadores con clientes; destino: todos, con cuántos clientes tiene cada uno", async () => {
    await mount();
    const from = [...q("select[name=from]").options].slice(1).map((o) => o.textContent);
    const to = [...q("select[name=to]").options].slice(1).map((o) => o.textContent);
    expect(from).toEqual(["Ana · ana@x.co (3 clientes)", "Eva · eva@x.co (1 cliente)"]);
    expect(to).toEqual(["Ana · ana@x.co (3 clientes)", "Luis · luis@x.co (0 clientes)", "Eva · eva@x.co (1 cliente)"]);
  });

  it("pide los dos y que sean distintos, sin abrir la confirmación", async () => {
    await mount();
    submit();
    expect(q("#reassign-error").textContent).toBe("Elige los dos contadores.");
    choose("a", "a");
    submit();
    expect(q("#reassign-error").textContent).toBe("Elige dos contadores distintos.");
    expect(q("#reassign-dialog").open).toBeFalsy();
  });

  it("confirma con cuántos y a quién; Volver no mueve nada y devuelve el foco", async () => {
    await mount();
    choose("a", "l");
    submit();
    expect(q("#reassign-dialog").open).toBe(true);
    expect(q("#reassign-text").textContent).toBe(
      "Los 3 clientes de Ana · ana@x.co pasarán a Luis · luis@x.co. Sus asistentes dejarán de verlos."
    );
    q('[data-dialog="back"]').click();
    expect(adminApi.reassignClients).not.toHaveBeenCalled();
    expect(document.activeElement.textContent).toBe("Reasignar");
  });

  it("reasignar: llama a la API, avisa, recarga los contadores y lleva el foco al título", async () => {
    await mount();
    adminApi.reassignClients.mockResolvedValue({ moved: 3 });
    adminApi.accountants.mockResolvedValue({ items: [{ ...ANA, clientCount: 0 }, { ...LUIS, clientCount: 3 }, EVA] });
    choose("a", "l");
    submit();
    q('[data-dialog="confirm"]').click();
    await flush();
    expect(adminApi.reassignClients).toHaveBeenCalledWith("a", "l");
    expect(toasts()).toContain("Reasignaste 3 clientes.");
    expect([...q("select[name=from]").options].slice(1).map((o) => o.textContent)).toEqual([
      "Luis · luis@x.co (3 clientes)",
      "Eva · eva@x.co (1 cliente)",
    ]);
    expect(document.activeElement.id).toBe("reassign-title");
  });

  it("si la API lo rechaza (documentos repetidos), muestra el motivo y no recarga", async () => {
    await mount();
    adminApi.reassignClients.mockRejectedValue(
      new Error("El contador de destino ya tiene clientes con estos documentos: CC-1.")
    );
    choose("a", "l");
    submit();
    q('[data-dialog="confirm"]').click();
    await flush();
    expect(q("#reassign-error").textContent).toContain("CC-1");
    expect(adminApi.accountants).toHaveBeenCalledTimes(1);
  });

  it("con un solo cliente, el texto va en singular", async () => {
    await mount();
    choose("e", "l");
    submit();
    expect(q("#reassign-text").textContent).toBe(
      "El cliente de Eva · eva@x.co pasará a Luis · luis@x.co. Sus asistentes dejarán de verlo."
    );
  });

  it("vacío: ningún contador tiene clientes; o no hay otro contador que los reciba", async () => {
    await mount([LUIS, { ...LUIS, id: "x", name: "Xi" }]);
    expect(slot().textContent).toContain("Ningún contador tiene clientes para reasignar.");
    expect(q("#reassign-form")).toBeNull();
    document.body.innerHTML = `<div id="toast-root"></div><div id="slot"></div>`;
    await mount([ANA]);
    expect(slot().textContent).toContain("Hace falta otro contador con la cuenta activa para recibirlos.");
  });

  it("error al cargar: estado de error con Reintentar, que vuelve a pedir", async () => {
    adminApi.accountants
      .mockRejectedValueOnce(new Error("No se pudo conectar"))
      .mockResolvedValue({ items: [ANA, LUIS] });
    await mountReassign(slot());
    await flush();
    expect(q("#reassign-body").textContent).toContain("No se pudo conectar");
    q("[data-retry]").click();
    await flush();
    expect(q("#reassign-form")).not.toBeNull();
  });

  it("los nombres se escapan", async () => {
    await mount([{ ...ANA, name: "<b>Ana</b>" }, LUIS]);
    expect(q("select[name=from] b")).toBeNull();
    expect(q("select[name=from]").options[1].textContent).toBe("<b>Ana</b> · ana@x.co (3 clientes)");
  });
});

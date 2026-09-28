import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { appendInBatches, yieldToMain } from "../src/utils/scheduling.js";
import { createPagedList } from "../src/components/pagedList.js";
import { aggregateConcepts } from "../src/utils/aggregateConcepts.js";
import { createWorkerClient } from "../src/workers/workerClient.js";
import { sha256Hex, validateFile } from "../src/workers/upload.worker.js";
import { withQuery } from "../src/api/http.js";
import { ratingFor } from "../src/views/performance.view.js";

// jsdom no pinta: requestAnimationFrame se resuelve en la siguiente task.
beforeEach(() => vi.stubGlobal("requestAnimationFrame", (cb) => setTimeout(cb, 0)));
afterEach(() => vi.unstubAllGlobals());

describe("appendInBatches / yieldToMain", () => {
  it("agrega todos los ítems en lotes y en orden", async () => {
    const ul = document.createElement("ul");
    const items = Array.from({ length: 120 }, (_, i) => i);
    await appendInBatches(ul, items, (i) => `<li>${i}</li>`, { batchSize: 50 });
    expect(ul.children).toHaveLength(120);
    expect(ul.lastElementChild.textContent).toBe("119");
  });

  it("cede el hilo entre lotes con una TASK (otras tasks corren en medio)", async () => {
    const ul = document.createElement("ul");
    const order = [];
    const done = appendInBatches(
      ul,
      [1, 2, 3, 4],
      (i) => {
        order.push(`render ${i}`);
        return `<li>${i}</li>`;
      },
      { batchSize: 2 }
    );
    setTimeout(() => order.push("otra task"), 0);
    await done;
    // Entre el primer lote (1,2) y el segundo (3,4) se ejecutó otra task.
    expect(order.indexOf("otra task")).toBeGreaterThan(order.indexOf("render 2"));
    expect(order.indexOf("otra task")).toBeLessThan(order.indexOf("render 3"));
  });

  it("se detiene si se aborta", async () => {
    const ul = document.createElement("ul");
    const controller = new AbortController();
    const done = appendInBatches(ul, Array.from({ length: 100 }), () => "<li></li>", {
      batchSize: 10,
      signal: controller.signal,
    });
    controller.abort();
    await done;
    expect(ul.children.length).toBeLessThan(100);
  });

  it("usa scheduler.yield() si existe", async () => {
    const schedulerYield = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal("scheduler", { yield: schedulerYield });
    await yieldToMain();
    expect(schedulerYield).toHaveBeenCalled();
  });
});

describe("createPagedList", () => {
  function setup(pages) {
    document.body.innerHTML = `<ul id="list"></ul><button id="more" hidden></button><p id="status"></p>`;
    const fetchPage = vi.fn(async (cursor) => pages[cursor ?? "first"]);
    const list = createPagedList({
      container: document.getElementById("list"),
      moreButton: document.getElementById("more"),
      status: document.getElementById("status"),
      fetchPage,
      renderItem: (item) => `<li data-id="${item.id}">${item.name}</li>`,
      emptyHtml: "<li>vacío</li>",
      errorHtml: (m) => `<li>error: ${m}</li>`,
      itemLabel: "ítems",
    });
    return { list, fetchPage };
  }

  it("pinta la primera página, muestra 'Cargar más' y agrega la siguiente con el cursor", async () => {
    const { list, fetchPage } = setup({
      first: { items: [{ id: "a", name: "A" }], nextCursor: "c1" },
      c1: { items: [{ id: "b", name: "B" }], nextCursor: null },
    });
    await list.reload();
    const more = document.getElementById("more");
    expect(document.querySelectorAll("#list li")).toHaveLength(1);
    expect(more.hidden).toBe(false);

    more.click();
    await list.loadMore();
    expect(fetchPage).toHaveBeenLastCalledWith("c1");
    expect([...document.querySelectorAll("#list li")].map((li) => li.textContent)).toEqual(["A", "B"]);
    expect(more.hidden).toBe(true);
    expect(document.getElementById("status").textContent).toBe("Se cargaron 1 ítems más.");
  });

  it("muestra el estado vacío y los errores (escapados)", async () => {
    const empty = setup({ first: { items: [], nextCursor: null } });
    await empty.list.reload();
    expect(document.getElementById("list").textContent).toBe("vacío");

    const failing = setup({});
    failing.fetchPage.mockRejectedValueOnce(new Error("<b>caída</b>"));
    await failing.list.reload();
    expect(document.getElementById("list").innerHTML).toContain("&lt;b&gt;caída&lt;/b&gt;");
  });

  it("replaceItem actualiza un ítem ya cargado", async () => {
    const { list } = setup({ first: { items: [{ id: "a", name: "A" }], nextCursor: null } });
    await list.reload();
    expect(list.replaceItem("a", (i) => ({ ...i, name: "A2" }))).toEqual({ id: "a", name: "A2" });
    expect(list.replaceItem("zzz", (i) => i)).toBeNull();
  });
});

describe("aggregateConcepts", () => {
  it("suma por año y tipo sin errores de punto flotante", () => {
    const rows = aggregateConcepts([
      { conceptType: "gross_income", amount: "0.1", periodYear: 2025 },
      { conceptType: "gross_income", amount: "0.2", periodYear: 2025 },
      { conceptType: "withholding", amount: 5, periodYear: 2025 },
      { conceptType: "gross_income", amount: 7, periodYear: 2024 },
    ]);
    expect(rows).toEqual([
      { periodYear: 2025, count: 3, totals: { gross_income: 0.3, withholding: 5 } },
      { periodYear: 2024, count: 1, totals: { gross_income: 7 } },
    ]);
  });
});

describe("createWorkerClient (mensajes tipados y cancelación)", () => {
  class FakeWorker {
    static instances = [];
    constructor() {
      this.terminated = false;
      this.posted = [];
      FakeWorker.instances.push(this);
    }
    postMessage(message) {
      this.posted.push(message);
    }
    reply(data) {
      this.onmessage({ data });
    }
    terminate() {
      this.terminated = true;
    }
  }
  beforeEach(() => (FakeWorker.instances = []));

  it("correlaciona respuestas por id y propaga errores", async () => {
    const client = createWorkerClient(() => new FakeWorker());
    const a = client.run("hash", { file: "x" });
    const b = client.run("hash", { file: "y" });
    const worker = FakeWorker.instances[0];
    expect(worker.posted).toEqual([
      { type: "hash", id: 1, file: "x" },
      { type: "hash", id: 2, file: "y" },
    ]);
    worker.reply({ type: "hash:result", id: 2, result: "B" });
    worker.reply({ type: "hash:error", id: 1, message: "falló" });
    await expect(b).resolves.toBe("B");
    await expect(a).rejects.toThrow("falló");
  });

  it("abortar TERMINA el worker (interrumpe el cálculo) y el siguiente run crea uno nuevo", async () => {
    const client = createWorkerClient(() => new FakeWorker());
    const controller = new AbortController();
    const pending = client.run("hash", {}, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(FakeWorker.instances[0].terminated).toBe(true);

    client.run("validate", {});
    expect(FakeWorker.instances).toHaveLength(2);
  });
});

describe("upload.worker (funciones puras)", () => {
  it("validateFile", () => {
    expect(validateFile("a.pdf", 1000)).toEqual({ valid: true, errors: [] });
    expect(validateFile("a.exe", 1000).valid).toBe(false);
    expect(validateFile("a.pdf", 16 * 1024 * 1024).errors[0]).toMatch(/máximo permitido es 15 MB/);
  });

  it("sha256Hex coincide con el vector de prueba conocido de SHA-256('abc')", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
});

describe("utilidades", () => {
  it("withQuery omite parámetros vacíos", () => {
    expect(withQuery("/x", { cursor: null, limit: 50, q: "" })).toBe("/x?limit=50");
    expect(withQuery("/x", {})).toBe("/x");
  });

  it("ratingFor usa los umbrales de web.dev", () => {
    expect(ratingFor("INP", 200).text).toBe("Bueno");
    expect(ratingFor("INP", 201).text).toBe("Necesita mejorar");
    expect(ratingFor("CLS", 0.3).text).toBe("Malo");
    expect(ratingFor("LONG_TASK", 999)).toBeNull();
  });
});

describe("nextFrame en pestañas ocultas", () => {
  it("no espera un frame si el documento está oculto (el navegador pausa requestAnimationFrame)", async () => {
    const { nextFrame } = await import("../src/utils/scheduling.js");
    const raf = vi.fn(); // nunca llama al callback, como en una pestaña oculta
    vi.stubGlobal("requestAnimationFrame", raf);
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await expect(nextFrame()).resolves.toBeUndefined();
    expect(raf).not.toHaveBeenCalled();
    visibility.mockRestore();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { backoffDelay } from "../src/utils/backoff.js";
import { createPoller } from "../src/realtime/poller.js";

describe("backoffDelay (exponencial con jitter)", () => {
  it("crece exponencialmente y respeta el máximo", () => {
    const noJitter = { random: () => 1 }; // siempre el valor completo
    expect([0, 1, 2, 3, 4, 5, 10].map((n) => backoffDelay(n, noJitter))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
  });

  it("el jitter queda entre la mitad y el total del valor exponencial", () => {
    expect(backoffDelay(3, { random: () => 0 })).toBe(4000);
    expect(backoffDelay(3, { random: () => 0.5 })).toBe(6000);
  });
});

describe("createPoller (polling de respaldo)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("duplica la espera sin cambios, la reinicia al detectar uno y para sin pendientes", async () => {
    const results = [
      { pending: true, changed: false },
      { pending: true, changed: false },
      { pending: true, changed: true },
      { pending: false, changed: true },
    ];
    const poll = vi.fn(async () => results.shift());
    const delays = [];
    const poller = createPoller({ poll, initialMs: 1000, maxMs: 30_000, onSchedule: (ms) => delays.push(ms) });

    poller.start();
    for (let i = 0; i < 4; i++) await vi.runOnlyPendingTimersAsync();

    expect(poll).toHaveBeenCalledTimes(4);
    expect(delays).toEqual([1000, 2000, 4000, 1000]);
    expect(poller.isRunning()).toBe(false);
  });

  it("stop() cancela el siguiente sondeo", async () => {
    const poll = vi.fn(async () => ({ pending: true, changed: false }));
    const poller = createPoller({ poll, initialMs: 1000 });
    poller.start();
    poller.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(poll).not.toHaveBeenCalled();
  });

  it("un error de red no detiene el polling: sigue con más espera", async () => {
    const poll = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ pending: false, changed: false });
    const delays = [];
    const poller = createPoller({ poll, initialMs: 1000, onSchedule: (ms) => delays.push(ms) });
    poller.start();
    await vi.runOnlyPendingTimersAsync();
    await vi.runOnlyPendingTimersAsync();
    expect(delays).toEqual([1000, 2000]);
    expect(poller.isRunning()).toBe(false);
  });
});

describe("cliente WebSocket", () => {
  class FakeWebSocket {
    static instances = [];
    constructor(url) {
      this.url = url;
      this.sent = [];
      this.listeners = {};
      FakeWebSocket.instances.push(this);
    }
    addEventListener(type, fn) {
      (this.listeners[type] ??= []).push(fn);
    }
    send(data) {
      this.sent.push(JSON.parse(data));
    }
    close() {
      this.emit("close", {});
    }
    emit(type, event) {
      (this.listeners[type] || []).forEach((fn) => fn(event));
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    FakeWebSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeWebSocket);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("se autentica con el primer mensaje (no en la URL), entrega eventos y se reconecta si cae", async () => {
    const rt = await import("../src/realtime/realtime.js");
    const events = [];
    const statuses = [];
    rt.onDocumentUpdate((e) => events.push(e));
    rt.onRealtimeStatus((s) => statuses.push(s));

    rt.startRealtime(() => "token-secreto");
    const ws = FakeWebSocket.instances[0];
    expect(ws.url).toBe("ws://localhost:4000/ws");
    expect(ws.url).not.toContain("token");

    ws.emit("open");
    expect(ws.sent).toEqual([{ type: "auth", token: "token-secreto" }]);

    ws.emit("message", { data: JSON.stringify({ type: "ready" }) });
    ws.emit("message", { data: JSON.stringify({ type: "document.updated", documentId: "d1", status: "processed" }) });
    expect(events).toEqual([{ type: "document.updated", documentId: "d1", status: "processed" }]);
    expect(rt.getRealtimeStatus()).toBe("open");

    ws.emit("close", {});
    expect(rt.getRealtimeStatus()).toBe("closed");
    await vi.advanceTimersByTimeAsync(1000); // primer reintento: entre 500 y 1000 ms
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(statuses).toEqual(["connecting", "open", "closed", "connecting"]);

    rt.stopRealtime();
  });

  it("stopRealtime (logout) cierra y no vuelve a intentar", async () => {
    const rt = await import("../src/realtime/realtime.js");
    rt.startRealtime(() => "t");
    rt.stopRealtime();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("toWebSocketUrl usa wss con https", async () => {
    const { toWebSocketUrl } = await import("../src/realtime/realtime.js");
    expect(toWebSocketUrl("https://api.example.com")).toBe("wss://api.example.com/ws");
  });
});

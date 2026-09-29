import { afterEach, describe, expect, it, vi } from "vitest";

// La librería se reemplaza: estos tests verifican cómo se REPORTA, no cómo mide Chrome.
const handlers = {};
vi.mock("web-vitals", () => ({
  onLCP: (cb) => (handlers.LCP = cb),
  onCLS: (cb) => (handlers.CLS = cb),
  onINP: (cb) => (handlers.INP = cb),
  onTTFB: (cb) => (handlers.TTFB = cb),
  onFCP: (cb) => (handlers.FCP = cb),
}));
vi.mock("../src/router.js", () => ({ currentRoutePattern: () => "/clients/:id" }));

const { deviceCategory, flush, startWebVitals } = await import("../src/metrics/webVitals.js");

afterEach(() => vi.unstubAllGlobals());

describe("webVitals", () => {
  it("clasifica el dispositivo por ancho de ventana", () => {
    expect([375, 800, 1280].map(deviceCategory)).toEqual(["mobile", "tablet", "desktop"]);
  });

  it("envía por sendBeacon, como text/plain, con la ruta normalizada y sin datos personales", async () => {
    const sendBeacon = vi.fn().mockReturnValue(true);
    vi.stubGlobal("navigator", { sendBeacon });
    vi.stubGlobal(
      "PerformanceObserver",
      class {
        observe() {}
        disconnect() {}
      }
    );

    startWebVitals();
    handlers.LCP({ name: "LCP", value: 1234.5678, rating: "good", navigationType: "navigate" });
    handlers.INP({ name: "INP", value: 88, rating: "good", navigationType: "navigate" });
    flush();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe("http://localhost:4000/api/metrics/web-vitals");
    expect(blob.type).toBe("text/plain;charset=utf-8");
    const payload = JSON.parse(await blob.text());
    expect(payload.entries).toEqual([
      { route: "/clients/:id", name: "LCP", value: 1234.568, rating: "good", navigationType: "navigate" },
      { route: "/clients/:id", name: "INP", value: 88, rating: "good", navigationType: "navigate" },
    ]);
    expect(JSON.stringify(payload)).not.toMatch(/token|email|userId|@/);
  });

  it("no envía nada si la cola está vacía", () => {
    const sendBeacon = vi.fn();
    vi.stubGlobal("navigator", { sendBeacon });
    flush();
    expect(sendBeacon).not.toHaveBeenCalled();
  });
});

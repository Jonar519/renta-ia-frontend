/**
 * Arnés de medición de rendimiento (reproducible).
 *
 * Mide el BUILD DE PRODUCCIÓN (vite build + vite preview) contra una API con
 * el dataset sintético pesado (renta-ia-database/seed/perf/). Cada corrida
 * usa un contexto de navegador NUEVO (caché fría, sin Service Worker) con:
 *   - CPU ralentizada 4× (igual que el perfil móvil de Lighthouse)
 *   - red "Fast 4G" de Chrome DevTools: 9 Mbps bajada, 1,5 Mbps subida, 60 ms de latencia
 *
 * Escenarios:
 *   login      carga en frío de la pantalla de login
 *   dashboard  login → listado de clientes renderizado
 *   detail     detalle del cliente "Carga pesada" → tablas renderizadas,
 *              y luego 3 clics en pestañas (interacciones para INP)
 *
 * Métricas por escenario (se reporta la MEDIANA de N corridas):
 *   ttfbMs, fcpMs, lcpMs, cls        (Paint/LCP/Layout Shift, algoritmo de web-vitals)
 *   renderMs                         desde la acción del usuario hasta ver la tabla completa
 *   longTasks, tbtMs, maxLongTaskMs  tareas largas (> 50 ms) en la ventana medida; TBT = Σ(duración − 50)
 *   inpMs                            peor interacción (Event Timing); con < 50 interacciones INP = la peor
 *   jsKB, cssKB, fontKB, requests    bytes transferidos en la carga inicial
 *
 * Uso (cmd.exe):
 *   set PERF_BASE_URL=http://localhost:4173
 *   node perf\measure.mjs --label antes --runs 5
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((acc, arg, i, all) => (arg.startsWith("--") ? [...acc, [arg.slice(2), all[i + 1]]] : acc), [])
);
const LABEL = args.label ?? "sin-etiqueta";
const RUNS = Number(args.runs ?? 5);
const BASE_URL = process.env.PERF_BASE_URL ?? "http://localhost:4173";
const EMAIL = process.env.PERF_EMAIL ?? "ana@example.com";
const PASSWORD = process.env.PERF_PASSWORD ?? "Password123!";
const HEAVY_CLIENT_ID = process.env.PERF_HEAVY_CLIENT_ID ?? "eeeeeeee-0000-0000-0000-000000000001";
const CPU_SLOWDOWN = 4;
const NETWORK = { latency: 60, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 };

// Se inyecta ANTES del código de la app en cada documento.
function instrument() {
  const perf = { lcp: 0, clsWindows: [], longTasks: [], events: [], loaf: [], marks: {} };
  window.__perf = perf;
  const observe = (type, cb, extra = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach(cb)).observe({ type, buffered: true, ...extra });
    } catch {
      /* tipo no soportado por este navegador */
    }
  };
  observe("largest-contentful-paint", (e) => (perf.lcp = e.renderTime || e.startTime));
  // CLS: máxima "ventana de sesión" (huecos < 1 s, duración < 5 s), como web-vitals.
  let win = null;
  observe("layout-shift", (e) => {
    if (e.hadRecentInput) return;
    if (win && e.startTime - win.last < 1000 && e.startTime - win.first < 5000) {
      win.value += e.value;
      win.last = e.startTime;
    } else {
      win = { first: e.startTime, last: e.startTime, value: e.value };
      perf.clsWindows.push(win);
    }
  });
  observe("longtask", (e) => perf.longTasks.push({ start: e.startTime, duration: e.duration }));
  observe("long-animation-frame", (e) =>
    perf.loaf.push({ start: e.startTime, duration: e.duration, blocking: e.blockingDuration })
  );
  observe(
    "event",
    (e) => {
      if (e.interactionId)
        perf.events.push({ name: e.name, duration: e.duration, id: e.interactionId, start: e.startTime });
    },
    { durationThreshold: 16 }
  );
}

const median = (values) => {
  const v = values.filter((x) => typeof x === "number" && !Number.isNaN(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
};

/**
 * Bytes transferidos, a partir de los eventos de red (tamaño codificado real
 * de cada respuesta). Resource Timing no sirve para esto: los recursos de
 * otro origen reportan transferSize 0.
 */
function networkStats(page) {
  const net = page.__net;
  const own = (r) => r.url.startsWith(BASE_URL) || r.url.includes("localhost:4100");
  const kb = (list) => Math.round(list.reduce((s, r) => s + r.bytes, 0) / 102.4) / 10;
  return {
    jsKB: kb(net.filter((r) => r.type === "script")),
    cssKB: kb(net.filter((r) => r.type === "stylesheet")),
    fontKB: kb(net.filter((r) => r.type === "font")),
    apiKB: kb(net.filter((r) => r.url.includes("localhost:4100"))),
    thirdPartyKB: kb(net.filter((r) => !own(r))),
    requests: net.length,
    thirdPartyRequests: net.filter((r) => !own(r)).length,
  };
}

/** Métricas de la ventana [from, to] (ms de performance.now del documento). */
async function collect(page, from, to) {
  return { ...(await collectPerf(page, from, to)), ...networkStats(page) };
}

async function collectPerf(page, from, to) {
  return page.evaluate(
    ({ from, to }) => {
      const p = window.__perf;
      const nav = performance.getEntriesByType("navigation")[0];
      const fcp = performance.getEntriesByName("first-contentful-paint")[0];
      const inWindow = p.longTasks.filter((t) => t.start >= from && t.start <= to);
      const interactions = new Map();
      for (const e of p.events.filter((ev) => ev.start >= from)) {
        interactions.set(e.id, Math.max(interactions.get(e.id) ?? 0, e.duration));
      }
      return {
        ttfbMs: nav ? Math.round(nav.responseStart) : null,
        fcpMs: fcp ? Math.round(fcp.startTime) : null,
        lcpMs: Math.round(p.lcp),
        cls: Math.round(Math.max(0, ...p.clsWindows.map((w) => w.value)) * 1000) / 1000,
        longTasks: inWindow.length,
        tbtMs: Math.round(inWindow.reduce((s, t) => s + Math.max(0, t.duration - 50), 0)),
        maxLongTaskMs: Math.round(Math.max(0, ...inWindow.map((t) => t.duration))),
        loafBlockingMs: Math.round(
          p.loaf.filter((f) => f.start >= from && f.start <= to).reduce((s, f) => s + (f.blocking || 0), 0)
        ),
        inpMs: interactions.size ? Math.round(Math.max(...interactions.values())) : null,
        interactions: interactions.size,
      };
    },
    { from, to }
  );
}

async function newPage(browser) {
  const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const net = [];
  page.on("requestfinished", async (request) => {
    const sizes = await request.sizes().catch(() => null);
    net.push({ url: request.url(), type: request.resourceType(), bytes: sizes ? sizes.responseBodySize : 0 });
  });
  page.__net = net;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: CPU_SLOWDOWN });
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, ...NETWORK });
  return { context, page };
}

const now = (page) => page.evaluate(() => performance.now());

async function login(page) {
  await page.goto(`${BASE_URL}/#/login`, { waitUntil: "load" });
  await page.locator('#login-form input[name="email"]').fill(EMAIL);
  await page.locator('#login-form input[name="password"]').fill(PASSWORD);
}

const SCENARIOS = {
  async login(browser) {
    const { context, page } = await newPage(browser);
    await page.goto(`${BASE_URL}/#/login`, { waitUntil: "networkidle" }); // incluye las fuentes
    await page.waitForTimeout(500); // deja terminar LCP y posibles layout shifts (fuentes)
    const result = await collect(page, 0, await now(page));
    await context.close();
    return result;
  },

  async dashboard(browser) {
    const { context, page } = await newPage(browser);
    await login(page);
    const t0 = await now(page);
    await page.locator('#login-form button[type="submit"]').click();
    // Tabla completa: ninguna fila "Cargando..." y al menos una fila de cliente.
    await page.waitForFunction(
      () => {
        const rows = document.querySelectorAll("#clients-tbody tr");
        return rows.length > 1 && !document.querySelector("#clients-tbody .table__empty");
      },
      null,
      { timeout: 120_000 }
    );
    const t1 = await now(page);
    await page.waitForTimeout(300);
    const result = { ...(await collect(page, t0, t1 + 300)), renderMs: Math.round(t1 - t0) };
    await context.close();
    return result;
  },

  async detail(browser) {
    const { context, page } = await newPage(browser);
    await login(page);
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForFunction(() => location.hash === "#/");
    const t0 = await now(page);
    await page.evaluate((id) => (location.hash = `/clients/${id}`), HEAVY_CLIENT_ID);
    await page.waitForFunction(
      () => {
        const docs = document.querySelectorAll("#documents-table tbody tr[data-document-id]");
        const concepts = document.querySelectorAll("#concepts-table tbody tr");
        const alerts = document.querySelectorAll("#alerts-list .alert-item");
        return docs.length > 0 && concepts.length > 1 && alerts.length > 0;
      },
      null,
      { timeout: 120_000 }
    );
    const t1 = await now(page);
    // Interacciones reales (pestañas) para medir INP sobre la vista cargada.
    for (const tab of ["#tab-alerts", "#tab-summary", "#tab-documents"]) {
      await page.locator(tab).click();
      await page.waitForTimeout(400);
    }
    const t2 = await now(page);
    const result = { ...(await collect(page, t0, t2)), renderMs: Math.round(t1 - t0) };
    await context.close();
    return result;
  },
};

/**
 * Experimento A/B del render por lotes (solo con --scenario conceptsMore):
 * 3 clics en "Mostrar más conceptos" (200 filas cada uno) y se mide la
 * ventana de esos clics. Se corre contra dos builds: el normal (lotes de 50
 * que ceden el hilo) y uno temporal con un único lote (sin ceder).
 */
const EXPERIMENTS = {
  async conceptsMore(browser) {
    const { context, page } = await newPage(browser);
    await login(page);
    await page.locator('#login-form button[type="submit"]').click();
    await page.waitForFunction(() => location.hash === "#/");
    await page.evaluate((id) => (location.hash = `/clients/${id}`), HEAVY_CLIENT_ID);
    await page.waitForSelector("#concepts-more:not([hidden])", { timeout: 120_000 });
    await page.waitForTimeout(1000);
    const t0 = await now(page);
    for (let i = 0; i < 3; i++) {
      const before = await page.locator("#concepts-table tbody tr").count();
      await page.locator("#concepts-more").click();
      await page.waitForFunction(
        (n) => document.querySelectorAll("#concepts-table tbody tr").length >= n + 200,
        before
      );
      await page.waitForTimeout(300);
    }
    const result = await collect(page, t0, await now(page));
    await context.close();
    return result;
  },
};
Object.assign(SCENARIOS, EXPERIMENTS);
const DEFAULT_SCENARIOS = ["login", "dashboard", "detail"];

const browser = await chromium.launch({ channel: "chrome" });
const version = browser.version();
const report = {
  label: LABEL,
  date: new Date().toISOString(),
  method: {
    browser: `Chrome ${version} (Playwright ${JSON.parse(fs.readFileSync(new URL("../node_modules/@playwright/test/package.json", import.meta.url))).version})`,
    cpuSlowdown: `${CPU_SLOWDOWN}x`,
    network: "Fast 4G (9 Mbps / 1,5 Mbps / 60 ms)",
    viewport: "1280x800",
    runs: RUNS,
    cache: "fría (contexto nuevo por corrida, Service Worker bloqueado)",
    baseUrl: BASE_URL,
  },
  scenarios: {},
};

const only = args.scenario ? [args.scenario] : DEFAULT_SCENARIOS;
for (const name of only) {
  const runs = [];
  for (let i = 0; i < RUNS; i++) {
    runs.push(await SCENARIOS[name](browser));
    process.stdout.write(`${name} ${i + 1}/${RUNS}\r`);
  }
  const keys = Object.keys(runs[0]);
  report.scenarios[name] = { median: Object.fromEntries(keys.map((k) => [k, median(runs.map((r) => r[k]))])), runs };
  console.log(`${name.padEnd(10)} ${JSON.stringify(report.scenarios[name].median)}`);
}
await browser.close();

const outDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "results");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, `${LABEL}.json`);
fs.writeFileSync(file, JSON.stringify(report, null, 2));
console.log(`\nResultados: ${file}`);

/**
 * Perfil del hilo principal (traza de Chrome) para encontrar QUÉ bloquea.
 *
 * Graba una traza del escenario "detalle del cliente pesado" (mismas
 * condiciones que measure.mjs: CPU 4×, Fast 4G) y suma el tiempo del hilo
 * principal del renderer por tipo de evento: ParseHTML (innerHTML),
 * UpdateLayoutTree (recálculo de estilos), Layout, Paint, JS (FunctionCall /
 * EvaluateScript / microtareas), GC, y lo separa en "carga" y "clics en pestañas".
 *
 * Uso (cmd.exe):  node perf\profile.mjs --label antes
 * Guarda perf/results/profile-<label>.json (resumen, no la traza completa).
 */
import fs from "node:fs";
import path from "node:path";
import { chromium } from "@playwright/test";

const LABEL = process.argv[process.argv.indexOf("--label") + 1] ?? "sin-etiqueta";
const BASE_URL = process.env.PERF_BASE_URL ?? "http://localhost:4173";
const HEAVY = process.env.PERF_HEAVY_CLIENT_ID ?? "eeeeeeee-0000-0000-0000-000000000001";
const outDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, "$1")), "results");
const traceFile = path.join(outDir, `trace-${LABEL}.json`);

const GROUPS = {
  ParseHTML: "Parseo de HTML (innerHTML)",
  UpdateLayoutTree: "Recálculo de estilos",
  Layout: "Layout",
  PrePaint: "Pintado",
  Paint: "Pintado",
  Layerize: "Pintado",
  FunctionCall: "JavaScript",
  EvaluateScript: "JavaScript",
  "v8.compile": "JavaScript",
  RunMicrotasks: "JavaScript",
  TimerFire: "JavaScript",
  EventDispatch: "JavaScript",
  MinorGC: "Recolección de basura",
  MajorGC: "Recolección de basura",
  "V8.GC_SCAVENGER": "Recolección de basura",
};

const browser = await chromium.launch({ channel: "chrome" });
const context = await browser.newContext({ serviceWorkers: "block", viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const cdp = await context.newCDPSession(page);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 4 });
await cdp.send("Network.enable");
await cdp.send("Network.emulateNetworkConditions", {
  offline: false,
  latency: 60,
  downloadThroughput: (9 * 1024 * 1024) / 8,
  uploadThroughput: (1.5 * 1024 * 1024) / 8,
});

await page.goto(`${BASE_URL}/#/login`, { waitUntil: "load" });
await page.locator('#login-form input[name="email"]').fill(process.env.PERF_EMAIL ?? "ana@example.com");
await page.locator('#login-form input[name="password"]').fill(process.env.PERF_PASSWORD ?? "Password123!");
await page.locator('#login-form button[type="submit"]').click();
await page.waitForFunction(() => location.hash === "#/");
await page.waitForTimeout(1500);

fs.mkdirSync(outDir, { recursive: true });
await browser.startTracing(page, {
  path: traceFile,
  categories: ["devtools.timeline", "disabled-by-default-devtools.timeline", "v8"],
});
const marks = {};
marks.loadStart = Date.now();
await page.evaluate((id) => (location.hash = `/clients/${id}`), HEAVY);
await page.waitForFunction(
  () =>
    document.querySelectorAll("#documents-table tbody tr[data-document-id]").length > 0 &&
    document.querySelectorAll("#alerts-list .alert-item").length > 0,
  null,
  { timeout: 120_000 }
);
await page.waitForTimeout(500);
marks.clicksStart = Date.now();
for (const tab of ["#tab-alerts", "#tab-summary", "#tab-documents"]) {
  await page.locator(tab).click();
  await page.waitForTimeout(400);
}
marks.end = Date.now();
await browser.stopTracing();
await browser.close();

// --- Análisis de la traza ---
const { traceEvents } = JSON.parse(fs.readFileSync(traceFile, "utf8"));
const main = traceEvents.find((e) => e.name === "thread_name" && e.args?.name === "CrRendererMain");
const onMain = traceEvents.filter((e) => e.pid === main.pid && e.tid === main.tid && e.ph === "X" && e.dur);
const t0 = Math.min(...onMain.map((e) => e.ts));
// Ventana de clics: por tiempo relativo (ms reales, la traza está en µs).
const clickFrom = t0 + (marks.clicksStart - marks.loadStart) * 1000;

function summarize(events) {
  const byGroup = {};
  for (const e of events) {
    const group = GROUPS[e.name];
    if (!group) continue;
    byGroup[group] = (byGroup[group] ?? 0) + e.dur / 1000;
  }
  return Object.fromEntries(
    Object.entries(byGroup)
      .map(([k, v]) => [k, Math.round(v)])
      .sort((a, b) => b[1] - a[1])
  );
}
// Solo eventos de nivel superior dentro de una tarea, para no contar doble
// (p. ej. un Layout forzado dentro de un FunctionCall).
const tasks = onMain.filter((e) => e.name === "RunTask");
function topLevelChildren(from, to) {
  const inWindow = onMain.filter((e) => e.ts >= from && e.ts < to && e.name !== "RunTask");
  return inWindow.filter((e) => {
    const parentTask = tasks.find((t) => e.ts >= t.ts && e.ts < t.ts + t.dur);
    if (!parentTask) return true;
    // ¿está contenido en otro evento agrupado de la misma tarea?
    return !inWindow.some(
      (o) => o !== e && GROUPS[o.name] && o.ts <= e.ts && o.ts + o.dur >= e.ts + e.dur && o.dur > e.dur
    );
  });
}
const longTasks = (from, to) =>
  tasks.filter((t) => t.ts >= from && t.ts < to && t.dur > 50_000).map((t) => Math.round(t.dur / 1000));

const summary = {
  label: LABEL,
  date: new Date().toISOString(),
  carga: { porTipo: summarize(topLevelChildren(t0, clickFrom)), tareasLargasMs: longTasks(t0, clickFrom) },
  clicsEnPestanas: {
    porTipo: summarize(topLevelChildren(clickFrom, Infinity)),
    tareasLargasMs: longTasks(clickFrom, Infinity),
  },
};
fs.writeFileSync(path.join(outDir, `profile-${LABEL}.json`), JSON.stringify(summary, null, 2));
fs.rmSync(traceFile); // la traza completa pesa decenas de MB; se guarda solo el resumen
console.log(JSON.stringify(summary, null, 2));

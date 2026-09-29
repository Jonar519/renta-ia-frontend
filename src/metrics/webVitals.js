import { onCLS, onFCP, onINP, onLCP, onTTFB } from "web-vitals";
import { currentRoutePattern } from "../router.js";

/**
 * Métricas de rendimiento de usuarios reales (RUM).
 *
 * - Core Web Vitals con la librería oficial web-vitals: LCP, INP, CLS, más
 *   TTFB y FCP. INP (Interaction to Next Paint) reemplazó a FID como Core Web
 *   Vital en marzo de 2024: FID solo medía la ESPERA antes de procesar la
 *   PRIMERA interacción; INP mide la latencia completa (espera + procesamiento
 *   + pintado) de TODAS las interacciones y reporta una de las peores. Por
 *   eso web-vitals 5+ ya no exporta onFID.
 * - FID se sigue capturando aparte con PerformanceObserver("first-input"),
 *   solo como referencia histórica (p. ej. si se pide para comparar).
 * - Tareas largas del hilo principal: "long-animation-frame" (LoAF, con el
 *   script responsable) donde el navegador lo soporta, y "longtask" siempre.
 *
 * Privacidad: se envía la ruta NORMALIZADA ("/clients/:id") y una categoría
 * de dispositivo; nunca ids, correos, URL completa ni datos de la sesión.
 *
 * Envío: en lotes con navigator.sendBeacon (sobrevive al cierre de la
 * pestaña) cuando la página se oculta, o al juntar 20 entradas. El cuerpo va
 * como text/plain: es un tipo "simple" y no dispara preflight CORS.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
const ENDPOINT = `${API_URL}/api/metrics/web-vitals`;
const FLUSH_AT = 20;
const MAX_LONG_TASKS_PER_PAGE = 30; // tope de volumen por carga de página
const FID_THRESHOLDS = [100, 300]; // web.dev (histórico)

const queue = [];
let longTasksReported = 0;

export function deviceCategory(width = window.innerWidth) {
  if (width < 768) return "mobile";
  if (width < 1024) return "tablet";
  return "desktop";
}

const round = (value) => Math.round(value * 1000) / 1000;

function ratingFor(value, [good, poor]) {
  if (value <= good) return "good";
  if (value <= poor) return "needs-improvement";
  return "poor";
}

function enqueue(entry) {
  queue.push({ route: currentRoutePattern(), ...entry });
  if (queue.length >= FLUSH_AT) flush();
}

export function flush() {
  if (queue.length === 0) return;
  const body = JSON.stringify({ device: deviceCategory(), entries: queue.splice(0, 50) });
  const blob = new Blob([body], { type: "text/plain;charset=UTF-8" });
  const sent = typeof navigator.sendBeacon === "function" && navigator.sendBeacon(ENDPOINT, blob);
  if (!sent) {
    fetch(ENDPOINT, {
      method: "POST",
      body,
      keepalive: true,
      headers: { "Content-Type": "text/plain;charset=UTF-8" },
    }).catch(() => {});
  }
}

function observe(type, callback, options = {}) {
  try {
    const observer = new PerformanceObserver((list) => list.getEntries().forEach(callback));
    observer.observe({ type, buffered: true, ...options });
    return observer;
  } catch {
    return null; // tipo no soportado en este navegador
  }
}

/** Archivo del script que más bloqueó un long-animation-frame (sin ruta ni query string). */
function loafAttribution(entry) {
  const longest = [...(entry.scripts ?? [])].sort((a, b) => b.duration - a.duration)[0];
  if (!longest) return undefined;
  const file = (longest.sourceURL || "").split("/").pop().split("?")[0];
  return `${file || "(inline)"} ${longest.invokerType || ""}`.trim().slice(0, 200);
}

function reportLongTask(name, duration, attribution) {
  if (longTasksReported >= MAX_LONG_TASKS_PER_PAGE) return;
  longTasksReported++;
  enqueue({ name, value: round(duration), attribution });
}

export function startWebVitals() {
  const report = (metric) =>
    enqueue({
      name: metric.name,
      value: round(metric.value),
      rating: metric.rating,
      navigationType: metric.navigationType,
    });
  onLCP(report);
  onCLS(report);
  onINP(report);
  onTTFB(report);
  onFCP(report);

  const fidObserver = observe("first-input", (entry) => {
    const value = entry.processingStart - entry.startTime;
    enqueue({ name: "FID", value: round(value), rating: ratingFor(value, FID_THRESHOLDS) });
    fidObserver?.disconnect(); // solo la primera interacción
  });

  // LoAF es más informativo (atribuye el script); longtask cubre el resto de navegadores.
  const loaf = observe("long-animation-frame", (entry) => {
    if (entry.blockingDuration > 0) reportLongTask("LOAF", entry.duration, loafAttribution(entry));
  });
  observe("longtask", (entry) => {
    if (!loaf) reportLongTask("LONG_TASK", entry.duration);
  });

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
  window.addEventListener("pagehide", flush);
}

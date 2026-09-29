/**
 * Polling de respaldo con backoff: se usa SOLO mientras el WebSocket no está
 * disponible y todavía hay documentos pendientes. Empieza cada `initialMs`
 * y duplica la espera cuando no hay cambios, hasta `maxMs`; vuelve a
 * `initialMs` cuando detecta un cambio.
 *
 * `poll()` debe devolver { pending: boolean, changed: boolean }.
 * Se detiene solo cuando ya no quedan documentos pendientes.
 */
export function createPoller({ poll, initialMs = 3000, maxMs = 30_000, onSchedule = () => {} }) {
  let timer = null;
  let delay = initialMs;
  let running = false;

  function schedule() {
    onSchedule(delay);
    timer = setTimeout(async () => {
      timer = null;
      if (!running) return;
      let result;
      try {
        result = await poll();
      } catch {
        // Error de red: se sigue intentando con más espera.
        result = { pending: true, changed: false };
      }
      if (!running) return;
      if (!result.pending) {
        stop();
        return;
      }
      delay = result.changed ? initialMs : Math.min(maxMs, delay * 2);
      schedule();
    }, delay);
  }

  function start() {
    if (running) return;
    running = true;
    delay = initialMs;
    schedule();
  }

  function stop() {
    running = false;
    clearTimeout(timer);
    timer = null;
  }

  return { start, stop, isRunning: () => running };
}

/**
 * Cliente promesa ⇄ Web Worker con mensajes tipados y cancelación.
 *
 * Protocolo (ver los typedef de cada worker):
 *   hilo principal → worker:  { type, id, ...payload }
 *   worker → hilo principal:  { type: `${type}:result`, id, result }
 *                          |  { type: `${type}:error`,  id, message }
 *
 * Cancelación: run(..., { signal }). Al abortar se TERMINA el worker
 * (worker.terminate()), lo que interrumpe incluso un cálculo síncrono en
 * curso (p. ej. un digest SHA-256 de 15 MB); el siguiente run() crea uno nuevo.
 */
export function createWorkerClient(createWorker) {
  let worker = null;
  let nextId = 0;
  const pending = new Map();

  function rejectAll(reason) {
    for (const { reject } of pending.values()) reject(reason);
    pending.clear();
  }

  function terminate(reason = new DOMException("Operación cancelada", "AbortError")) {
    worker?.terminate();
    worker = null;
    rejectAll(reason);
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = createWorker();
    worker.onmessage = ({ data }) => {
      const entry = pending.get(data.id);
      if (!entry) return; // respuesta de una petición ya cancelada
      pending.delete(data.id);
      if (String(data.type).endsWith(":error")) entry.reject(new Error(data.message));
      else entry.resolve(data.result);
    };
    worker.onerror = (event) => terminate(new Error(event.message || "Error en el Web Worker"));
    return worker;
  }

  function run(type, payload = {}, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(new DOMException("Operación cancelada", "AbortError"));
        return;
      }
      const id = ++nextId;
      pending.set(id, { resolve, reject });
      signal?.addEventListener("abort", () => pending.has(id) && terminate(), { once: true });
      ensureWorker().postMessage({ type, id, ...payload });
    });
  }

  return { run, terminate };
}

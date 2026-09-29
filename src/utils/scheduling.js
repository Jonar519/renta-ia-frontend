/**
 * Utilidades del event loop para no bloquear el hilo principal.
 *
 * ¿Por qué ceder con una TASK y no con una MICROTASK?
 *   await Promise.resolve() / queueMicrotask() encolan una microtask: el
 *   navegador vacía la cola de microtasks COMPLETA antes de volver al event
 *   loop, así que entre un lote y el siguiente no hay oportunidad de pintar
 *   ni de atender un clic. Partir el trabajo en microtasks no reduce ninguna
 *   tarea larga: sigue siendo una sola tarea para el navegador.
 *   Una task (scheduler.yield() o setTimeout) sí devuelve el control al
 *   event loop: entre lote y lote el navegador puede procesar input (lo que
 *   mejora el INP) y renderizar.
 *
 * scheduler.yield() (Chrome 129+) además reanuda la continuación con
 * prioridad sobre otras tasks pendientes, así el trabajo no queda al final
 * de la cola; donde no existe se usa setTimeout(0).
 */
export function yieldToMain() {
  if (globalThis.scheduler?.yield) return globalThis.scheduler.yield();
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Espera al próximo frame (justo antes del render). Las escrituras al DOM se
 * agrupan aquí: se hacen todas juntas una vez por frame, sin intercalar
 * lecturas de layout (offsetHeight, getBoundingClientRect…) que obligarían
 * al navegador a recalcular el layout a mitad de un lote (layout thrashing).
 */
export function nextFrame() {
  // En una pestaña oculta el navegador PAUSA requestAnimationFrame: esperar
  // un frame dejaría la tabla vacía hasta que el usuario vuelva a la pestaña.
  // Sin nada que pintar, no hay frame que esperar: se escribe de inmediato.
  if (typeof document !== "undefined" && document.visibilityState === "hidden") return Promise.resolve();
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

/**
 * Agrega `items` al final de `container` en lotes: arma el HTML de un lote
 * (solo JS, sin tocar el DOM), lo escribe en un único insertAdjacentHTML
 * dentro de requestAnimationFrame y cede el hilo antes del siguiente lote.
 *
 * @param {Element} container
 * @param {unknown[]} items
 * @param {(item: unknown) => string} renderItem  debe escapar el contenido
 * @param {{ batchSize?: number, signal?: AbortSignal }} [options]
 */
export async function appendInBatches(container, items, renderItem, { batchSize = 50, signal } = {}) {
  for (let i = 0; i < items.length; i += batchSize) {
    if (signal?.aborted) return;
    const html = items
      .slice(i, i + batchSize)
      .map(renderItem)
      .join("");
    await nextFrame();
    if (signal?.aborted) return;
    container.insertAdjacentHTML("beforeend", html);
    if (i + batchSize < items.length) await yieldToMain();
  }
}

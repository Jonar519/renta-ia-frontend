import { appendInBatches } from "../utils/scheduling.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * Lista paginada por cursor con botón "Cargar más" (clientes, documentos,
 * alertas). Cada página se agrega al DOM en lotes que ceden el hilo
 * (utils/scheduling.js), así que ni la primera carga ni "Cargar más"
 * producen una tarea larga aunque la página sea grande.
 *
 * @param {object} options
 * @param {Element} options.container        <tbody> o <ul> donde van los ítems
 * @param {HTMLButtonElement} options.moreButton
 * @param {Element} [options.status]          región aria-live para anunciar cuántos se cargaron
 * @param {(cursor: string | null) => Promise<{ items: any[], nextCursor: string | null }>} options.fetchPage
 * @param {(item: any) => string} options.renderItem  HTML escapado de un ítem
 * @param {string} options.emptyHtml
 * @param {(message: string) => string} options.errorHtml
 * @param {string} options.itemLabel          "documentos", "clientes"… (para los anuncios)
 */
export function createPagedList({
  container,
  moreButton,
  status,
  fetchPage,
  renderItem,
  emptyHtml,
  errorHtml,
  itemLabel,
}) {
  let items = [];
  let nextCursor = null;
  let loading = null;
  let generation = 0; // invalida páginas en vuelo si se recarga la lista

  function updateButton() {
    moreButton.hidden = !nextCursor;
    moreButton.disabled = false;
  }

  async function load(cursor) {
    const current = generation;
    const page = await fetchPage(cursor);
    if (current !== generation) return null; // la lista se recargó mientras llegaba esta página
    return page;
  }

  async function reload() {
    generation++;
    moreButton.hidden = true;
    try {
      const page = await load(null);
      if (!page) return items;
      items = page.items;
      nextCursor = page.nextCursor;
      container.innerHTML = "";
      if (items.length === 0) container.innerHTML = emptyHtml;
      else await appendInBatches(container, items, renderItem);
      updateButton();
    } catch (err) {
      container.innerHTML = errorHtml(escapeHtml(err.message));
    }
    return items;
  }

  async function loadMore() {
    if (!nextCursor || loading) return loading;
    moreButton.disabled = true;
    moreButton.setAttribute("aria-busy", "true");
    loading = (async () => {
      try {
        const page = await load(nextCursor);
        if (!page) return;
        items = items.concat(page.items);
        nextCursor = page.nextCursor;
        await appendInBatches(container, page.items, renderItem);
        if (status) status.textContent = `Se cargaron ${page.items.length} ${itemLabel} más.`;
      } catch (err) {
        if (status) status.textContent = `No se pudieron cargar más ${itemLabel}: ${err.message}`;
      } finally {
        moreButton.removeAttribute("aria-busy");
        loading = null;
        updateButton();
      }
    })();
    return loading;
  }

  moreButton.addEventListener("click", () => loadMore());

  return {
    reload,
    loadMore,
    getItems: () => items,
    /** Reemplaza un ítem ya cargado (p. ej. por un evento en tiempo real). */
    replaceItem(id, updater) {
      const index = items.findIndex((item) => item.id === id);
      if (index === -1) return null;
      items[index] = updater(items[index]);
      return items[index];
    },
  };
}

import { bindRetry, errorStateHtml, skeletonBlockHtml } from "../../components/states.js";
import { escapeHtml } from "../../utils/escapeHtml.js";

/**
 * Visor del documento original (B17, vista dividida I). Se descarga al abrir
 * "Ver original"; pdf.js (excepción D3, con su propio tope) se descarga recién
 * si el archivo es un PDF: una imagen se muestra con <img> y no lo carga.
 *
 * El archivo lo pide con la sesión documents.section.js (se inyecta: fetchFile)
 * y se muestra como blob:. El cliente del portal no tiene visor (solo descarga). La CSP sigue
 * estricta: object-src y frame-src 'none' (no se usa el visor del navegador).
 *
 * Estados propios: cargando, error con Reintentar, PDF con contraseña, PDF e
 * imagen. Siempre se puede descargar el original (también es la alternativa
 * accesible: el canvas de un PDF no expone su texto a un lector de pantalla).
 */
const ZOOM_STEP = 0.25;

/** pdf.js y su worker (mismo origen), solo cuando hace falta mostrar un PDF. */
async function loadPdfJs() {
  // Los dos archivos de Mozilla tal cual (?url: se copian a dist/assets, mismo
  // origen). Si Vite empaquetara pdf.js como módulo, lo volvería a minificar y
  // pesaría más (140 KB gzip en vez de 129).
  const [{ default: libUrl }, { default: workerUrl }] = await Promise.all([
    import("pdfjs-dist/build/pdf.min.mjs?url"),
    import("pdfjs-dist/build/pdf.worker.min.mjs?url"),
  ]);
  const pdfjs = await import(/* @vite-ignore */ libUrl);
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  return pdfjs;
}

/**
 * Abre el visor en `host`. onClose: al cerrarlo (el foco vuelve a quien lo abrió).
 * Devuelve { close }.
 */
export function openDocumentViewer(host, doc, { fetchFile, onClose = () => {} }) {
  host.innerHTML = `
    <section class="viewer" aria-labelledby="viewer-title">
      <header class="viewer__bar">
        <h2 id="viewer-title" class="viewer__title" tabindex="-1">${escapeHtml(doc.originalName)}</h2>
        <div class="viewer__tools">
          <span class="viewer__pdf-tools" hidden>
            <button type="button" class="btn btn--ghost btn--small" data-prev aria-label="Página anterior">‹</button>
            <span class="num" data-page aria-live="polite"></span>
            <button type="button" class="btn btn--ghost btn--small" data-next aria-label="Página siguiente">›</button>
            <button type="button" class="btn btn--ghost btn--small" data-zoom-out aria-label="Alejar">−</button>
            <button type="button" class="btn btn--ghost btn--small" data-zoom-in aria-label="Acercar">+</button>
          </span>
          <a class="btn btn--ghost btn--small" data-download hidden>Descargar</a>
          <button type="button" class="btn btn--ghost btn--small" data-close>Cerrar</button>
        </div>
      </header>
      <div class="viewer__page" data-page-box role="region" aria-label="Documento original" tabindex="0"></div>
    </section>`;
  const box = host.querySelector("[data-page-box]");
  const pdfTools = host.querySelector(".viewer__pdf-tools");
  const pageLabel = host.querySelector("[data-page]");
  const download = host.querySelector("[data-download]");
  let url = null;
  let task = null; // pdf.js: se destruye la tarea de carga (libera el worker)
  let pdf = null;
  let page = 1;
  let zoom = 1;
  let closed = false;

  async function renderPage() {
    const p = await pdf.getPage(page);
    // Ancho de la página a la medida de la caja; el zoom multiplica sobre eso.
    const fit = Math.max(box.clientWidth - 24, 280) / p.getViewport({ scale: 1 }).width;
    const viewport = p.getViewport({ scale: fit * zoom });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", `Página ${page} de ${pdf.numPages} de ${doc.originalName}`);
    await p.render({ canvas, canvasContext: canvas.getContext("2d"), viewport }).promise;
    if (closed) return;
    box.replaceChildren(canvas);
    pageLabel.textContent = `${page} / ${pdf.numPages}`;
    host.querySelector("[data-prev]").disabled = page <= 1;
    host.querySelector("[data-next]").disabled = page >= pdf.numPages;
  }

  async function openPdf(blob) {
    const pdfjs = await loadPdfJs();
    try {
      task = pdfjs.getDocument({ data: new Uint8Array(await blob.arrayBuffer()), useWasm: false });
      pdf = await task.promise;
    } catch (err) {
      if (err?.name === "PasswordException") {
        throw new Error("Este PDF está protegido con contraseña: no se puede mostrar aquí. Descárgalo para abrirlo.", {
          cause: err,
        });
      }
      throw new Error("El PDF está dañado o no se puede leer. Descárgalo para revisarlo.", { cause: err });
    }
    pdfTools.hidden = false;
    page = 1;
    await renderPage();
  }

  async function load() {
    box.innerHTML = skeletonBlockHtml({ lines: 8 });
    box.setAttribute("aria-busy", "true");
    pdfTools.hidden = true;
    try {
      const { blob, type } = await fetchFile(doc.id);
      if (closed) return;
      if (url) URL.revokeObjectURL(url);
      url = URL.createObjectURL(blob);
      download.href = url;
      download.download = doc.originalName;
      download.hidden = false;
      if (type.startsWith("image/")) {
        box.innerHTML = `<img src="${url}" alt="Documento original: ${escapeHtml(doc.originalName)}" />`;
      } else if (type === "application/pdf") {
        await openPdf(blob);
      } else {
        throw new Error("Este tipo de archivo no se puede mostrar aquí. Descárgalo para abrirlo.");
      }
    } catch (err) {
      if (closed) return;
      box.innerHTML = errorStateHtml(err.message, { title: "No se pudo mostrar el documento." });
    } finally {
      box.removeAttribute("aria-busy");
    }
  }
  bindRetry(box, load);

  function close() {
    if (closed) return;
    closed = true;
    listeners.abort();
    task?.destroy();
    if (url) URL.revokeObjectURL(url);
    host.innerHTML = "";
    onClose();
  }

  // Se quitan al cerrar: el siguiente visor usa el mismo host.
  const listeners = new AbortController();
  host.addEventListener(
    "click",
    (event) => {
      if (event.target.closest("[data-close]")) return close();
      if (!pdf) return;
      const go = (fn) => {
        fn();
        renderPage();
      };
      if (event.target.closest("[data-prev]") && page > 1) go(() => page--);
      if (event.target.closest("[data-next]") && page < pdf.numPages) go(() => page++);
      if (event.target.closest("[data-zoom-in]")) go(() => (zoom = Math.min(3, zoom + ZOOM_STEP)));
      if (event.target.closest("[data-zoom-out]")) go(() => (zoom = Math.max(0.5, zoom - ZOOM_STEP)));
    },
    listeners
  );
  host.addEventListener(
    "keydown",
    (event) => {
      if (event.key === "Escape") close();
    },
    listeners
  );

  host.querySelector("#viewer-title").focus();
  load();
  return { close };
}

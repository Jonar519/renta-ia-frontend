import { expect, test as base } from "@playwright/test";

/**
 * `test` de TODAS las pruebas E2E: vigila la Content-Security-Policy en cada
 * página de la prueba (el contexto principal y los que la prueba abra con
 * browser.newContext() / browser.newPage()) y, al terminar, exige cero
 * violaciones. Cada una se informa con la directiva, lo bloqueado, el archivo
 * y la línea que la causó, y la pantalla (#/ruta) donde ocurrió.
 *
 * Única excepción: la traza de Playwright (trace: "retain-on-failure") vuelve
 * a pedir con fetch las imágenes blob: de la página (la foto de perfil) para
 * guardarlas en la traza. Esa petición la hace la herramienta, no la app: se
 * reconoce por ser connect-src a blob: SIN archivo de origen. Con la traza
 * apagada no ocurre (verificado en B12). Cualquier otra violación cuenta.
 *
 * La prueba que provoca violaciones a propósito (csp.spec.js) lee la lista con
 * el fixture `cspViolations` y la vacía después de comprobarla.
 */
function listenForCspViolations() {
  document.addEventListener("securitypolicyviolation", (e) => {
    const fromTraceTool = e.violatedDirective === "connect-src" && e.blockedURI === "blob" && !e.sourceFile;
    if (!fromTraceTool)
      window.__reportCsp(
        `${e.violatedDirective} ${e.blockedURI} (${e.sourceFile}:${e.lineNumber}) en ${location.hash || location.pathname}`
      );
  });
}

export const test = base.extend({
  cspViolations: [
    async ({ context, browser }, use) => {
      const violations = [];
      const watch = async (ctx) => {
        await ctx.exposeFunction("__reportCsp", (v) => violations.push(v));
        await ctx.addInitScript(listenForCspViolations);
        return ctx;
      };
      await watch(context);
      // Los contextos que abre la prueba se cierran al final, ESPERANDO a que
      // cierren: un contexto a medio cerrar (o uno olvidado) en el navegador
      // compartido del worker hacía fallar el arranque de la prueba siguiente
      // ("Target page, context or browser has been closed").
      const opened = [];
      const { newContext } = browser;
      browser.newContext = async (options) => {
        const ctx = await newContext.call(browser, options);
        opened.push(ctx);
        return watch(ctx);
      };
      browser.newPage = async (options) => (await browser.newContext(options)).newPage();
      try {
        await use(violations);
      } finally {
        delete browser.newContext; // vuelven los métodos del prototipo
        delete browser.newPage;
        await Promise.all(opened.map((ctx) => ctx.close().catch(() => {})));
      }
      expect(violations, "Violaciones de la Content-Security-Policy").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

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
      const { newContext, newPage } = browser;
      browser.newContext = async (options) => watch(await newContext.call(browser, options));
      browser.newPage = async (options) => {
        const ctx = await browser.newContext(options);
        const page = await ctx.newPage();
        page.on("close", () => ctx.close().catch(() => {}));
        return page;
      };
      try {
        await use(violations);
      } finally {
        browser.newContext = newContext;
        browser.newPage = newPage;
      }
      expect(violations, "Violaciones de la Content-Security-Policy").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

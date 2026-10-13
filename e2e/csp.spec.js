import { expect, test } from "./fixtures.js";

/**
 * Prueba del vigilante de la CSP (e2e/fixtures.js): las violaciones reales SÍ
 * se cuentan (aunque se ignore la petición blob: de la traza de Playwright),
 * con la pantalla donde ocurrieron, también en los contextos que la prueba
 * abre aparte. Se provocan a propósito; al final se vacía la lista para que
 * el propio fixture no falle por ellas.
 */

/** Provoca tres violaciones: estilo en línea, conexión e imagen a un origen ajeno. */
const violateCsp = (page) =>
  page.evaluate(async () => {
    document.body.insertAdjacentHTML("beforeend", '<div style="color: red">en línea</div>');
    await fetch("https://ejemplo.invalid/fuga").catch(() => {});
    const img = new Image();
    img.src = "https://ejemplo.invalid/pixel.png";
    document.body.append(img);
  });

test("una violación real de la CSP queda registrada con su pantalla (no la tapa el filtro de la traza)", async ({
  page,
  cspViolations,
}) => {
  await page.goto("/#/login");
  await expect(page.locator("#login-form")).toBeVisible();
  expect(cspViolations).toEqual([]); // la página sola no viola nada

  await violateCsp(page);
  await expect.poll(() => cspViolations.length).toBeGreaterThanOrEqual(3);
  expect(cspViolations.some((v) => v.startsWith("style-src"))).toBe(true);
  expect(cspViolations.some((v) => v.startsWith("connect-src https://ejemplo.invalid"))).toBe(true);
  expect(cspViolations.some((v) => v.startsWith("img-src https://ejemplo.invalid"))).toBe(true);
  expect(cspViolations.every((v) => v.endsWith(" en #/login"))).toBe(true);
  cspViolations.length = 0;
});

test("también se vigilan los contextos y páginas que la prueba abre aparte", async ({ browser, cspViolations }) => {
  const fromContext = await (await browser.newContext()).newPage();
  await fromContext.goto("/#/recuperar");
  await violateCsp(fromContext);
  await expect.poll(() => cspViolations.length).toBeGreaterThanOrEqual(3);
  expect(cspViolations.every((v) => v.endsWith(" en #/recuperar"))).toBe(true);
  cspViolations.length = 0;

  const fromBrowser = await browser.newPage();
  await fromBrowser.goto("/#/login");
  await violateCsp(fromBrowser);
  await expect.poll(() => cspViolations.length).toBeGreaterThanOrEqual(3);
  cspViolations.length = 0;
  await fromBrowser.close();
});

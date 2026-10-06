import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { collectCspViolations, markNoReload, signUp } from "./helpers.js";

/**
 * Estados explícitos de las vistas (docs/ui-states.md) en un navegador real:
 * skeleton, error con "Reintentar" sin recargar la página, vacío, avisos
 * flotantes que no bloquean clics y toasts de conectividad.
 */

const isClientsList = (request) => request.method() === "GET" && new URL(request.url()).pathname === "/api/clients";

test("skeleton → error → Reintentar (sin recargar) → datos", async ({ page }, testInfo) => {
  const csp = await collectCspViolations(page);
  await signUp(page);
  // Un cliente, para que el reintento tenga algo que pintar.
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  const form = page.locator("#new-client-form");
  await form.getByLabel("Nombre completo").fill("Cliente Reintento");
  await form.getByLabel("Cédula o NIT").fill(`R-${Date.now()}`);
  await form.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByText('Cliente "Cliente Reintento" creado.')).toBeVisible();

  // La API falla (500 en todos los reintentos automáticos de http.js) y tarda: se ve el skeleton.
  let fail = true;
  await page.route("**/api/clients*", async (route) => {
    if (!isClientsList(route.request())) return route.fallback();
    await new Promise((r) => setTimeout(r, 600));
    if (fail) await route.fulfill({ status: 500, json: { error: "Fallo simulado" } });
    else await route.continue();
  });
  await page.goto("/#/performance"); // sale y vuelve: el panel arranca de cero
  await page.goto("/#/");
  await expect(page.locator(".skeleton-row").first()).toBeVisible();
  await expect(page.locator("table[aria-busy=true]")).toHaveCount(1);
  await expectNoSeriousA11yViolations(page, testInfo, "clientes-cargando");

  const error = page.locator(".state--error");
  await expect(error).toBeVisible({ timeout: 30_000 });
  await expect(error).toContainText("No se pudieron cargar tus clientes.");
  await expectNoSeriousA11yViolations(page, testInfo, "clientes-error");

  const assertNoReload = await markNoReload(page);
  fail = false;
  await error.getByRole("button", { name: "Reintentar" }).click();
  await expect(page.getByRole("cell", { name: "Cliente Reintento", exact: true })).toBeVisible();
  await assertNoReload();
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);
  expect(csp, "Violaciones de la CSP").toEqual([]);
});

test("vacío orientativo para una cuenta nueva", async ({ page }, testInfo) => {
  await signUp(page);
  const empty = page.locator(".state--empty");
  await expect(empty).toContainText("Todavía no tienes clientes.");
  await expect(empty).toContainText('Crea el primero con "Nuevo cliente"');
  await expectNoSeriousA11yViolations(page, testInfo, "clientes-vacio");
});

test("los avisos flotantes no bloquean los clics de lo que tapan", async ({ page, context }) => {
  await signUp(page);
  const toast = page.locator("#toast-root .toast").first();
  await expect(toast).toBeVisible();

  // Lo que hay bajo el centro del toast es la página, no el toast.
  const box = await toast.boundingBox();
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const hit = await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    return { inToast: Boolean(el?.closest("#toast-root")), tag: el?.tagName };
  }, point);
  expect(hit.inToast, `elementFromPoint devolvió ${hit.tag} dentro del toast`).toBe(false);

  // Un clic real en ese punto llega al elemento de abajo.
  await page.evaluate(() => {
    window.__clicked = null;
    document.addEventListener("click", (e) => (window.__clicked = e.target.closest("#toast-root") ? "toast" : "page"), {
      once: true,
      capture: true,
    });
  });
  await page.mouse.click(point.x, point.y);
  expect(await page.evaluate(() => window.__clicked)).toBe("page");

  // Banner de "sin conexión" (sticky arriba): tampoco atrapa clics.
  await context.setOffline(true);
  const banner = page.locator(".connectivity-banner");
  await expect(banner).toBeVisible();
  const bannerBox = await banner.boundingBox();
  const underBanner = await page.evaluate(
    ({ x, y }) => Boolean(document.elementFromPoint(x, y)?.closest(".connectivity-banner")),
    { x: bannerBox.x + bannerBox.width / 2, y: bannerBox.y + bannerBox.height / 2 }
  );
  expect(underBanner).toBe(false);
  expect(await banner.evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  expect(await page.locator("#toast-root").evaluate((el) => getComputedStyle(el).pointerEvents)).toBe("none");
  await context.setOffline(false);
});

test("toast al perder y al recuperar la conexión", async ({ page, context }, testInfo) => {
  await signUp(page);
  await context.setOffline(true);
  const lost = page.locator(".toast", { hasText: "Se perdió la conexión a internet" });
  await expect(lost).toBeVisible();
  await expect(page.locator(".connectivity-banner")).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "sin-conexion");

  await context.setOffline(false);
  await expect(page.locator(".toast", { hasText: "Conexión restablecida." })).toBeVisible();
  await expect(page.locator(".connectivity-banner")).toBeHidden();
});

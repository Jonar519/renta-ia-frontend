import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { collectCspViolations } from "./helpers.js";

/**
 * Guard de ruta por rol, menú de usuario y sidebar sin conexión, en Chrome.
 * Usa los usuarios del seed (renta-ia-database/seed: admin, contador y
 * asistente; el job de CI carga el seed).
 */

const PASSWORD = "Password123!";
const USERS = {
  assistant: "luis@example.com",
  accountant: "ana@example.com",
  admin: "admin@example.com",
};

async function login(page, email) {
  await page.goto("/#/login");
  const form = page.locator("#login-form");
  await form.getByLabel("Correo").fill(email);
  await form.getByLabel("Contraseña").fill(PASSWORD);
  await form.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
}

/** Peticiones del chunk de la vista de Rendimiento (no debe descargarse si no hay permiso). */
function watchPerformanceChunk(page) {
  const requests = [];
  page.on("request", (r) => /performance\.view-[\w-]+\.js$/.test(r.url()) && requests.push(r.url()));
  return requests;
}

test("un asistente que escribe la URL de Rendimiento rebota a Clientes con un aviso claro", async ({
  page,
}, testInfo) => {
  const csp = await collectCspViolations(page);
  const chunk = watchPerformanceChunk(page);
  await login(page, USERS.assistant);
  await expect(page.getByRole("link", { name: "Rendimiento" })).toHaveCount(0); // ni siquiera ve el enlace

  // 1) Carga completa de la página con la URL escrita a mano (deep link).
  await page.goto("/?desde=barra#/performance");
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
  const notice = page.getByRole("alert").filter({ hasText: 'No tienes permiso para ver "Rendimiento"' });
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("Tu rol (Asistente) no tiene acceso.");
  await expectNoSeriousA11yViolations(page, testInfo, "aviso-rebote");

  await notice.getByRole("button", { name: "Entendido" }).click();
  await expect(notice).toBeHidden();

  // 2) Dentro de la app ya cargada, cambiando el hash.
  const historyBefore = await page.evaluate(() => history.length);
  await page.evaluate(() => (window.location.hash = "#/performance"));
  await expect(page).toHaveURL(/#\/$/);
  const secondNotice = page.getByRole("alert").filter({ hasText: "No tienes permiso" });
  await expect(secondNotice).toBeVisible();
  // El rebote REEMPLAZA la entrada: el historial crece solo en la que agregó el
  // usuario (#/performance → #/). Con un push crecería en dos. (Durante la carga
  // de la página el navegador ya convierte todo cambio de hash en replace, por
  // eso esto se comprueba con la app cargada.)
  expect(await page.evaluate(() => history.length)).toBe(historyBefore + 1);
  // "Atrás" lleva a la página anterior sin volver a pasar por la ruta prohibida
  // (con un push rebotaría otra vez y el usuario quedaría atrapado).
  await secondNotice.getByRole("button", { name: "Entendido" }).click();
  await page.goBack();
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("alert")).toHaveCount(0);

  expect(chunk, "el código de la vista prohibida no se descargó").toEqual([]);
  expect(csp).toEqual([]);
});

test("un contador también rebota; el admin sí entra", async ({ browser }) => {
  const accountant = await (await browser.newContext()).newPage();
  await login(accountant, USERS.accountant);
  await accountant.goto("/?desde=barra#/performance");
  await expect(accountant).toHaveURL(/#\/$/);
  await expect(accountant.getByRole("alert")).toContainText("Tu rol (Contador/a) no tiene acceso.");

  const admin = await (await browser.newContext()).newPage();
  await login(admin, USERS.admin);
  await admin.goto("/?desde=barra#/performance");
  await expect(admin.getByRole("heading", { name: "Rendimiento" })).toBeVisible();
  await expect(admin).toHaveURL(/#\/performance$/);
  await expect(admin.getByRole("alert")).toHaveCount(0);
});

test("una ruta que no existe lleva a Clientes con aviso", async ({ page }) => {
  await login(page, USERS.accountant);
  await page.evaluate(() => (window.location.hash = "#/no-existe"));
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("alert")).toContainText("La página que buscabas no existe.");
});

test("menú de usuario: teclado, foco, clic fuera, Mi perfil y Salir", async ({ page }, testInfo) => {
  await login(page, USERS.accountant);
  const button = page.getByRole("button", { name: /menú de la cuenta/ });
  const menu = page.getByRole("menu");

  // Teclado: Enter abre y el foco va a la primera opción.
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(button).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("menuitem", { name: "Mi perfil" })).toBeFocused();
  await expect(page.locator(".user-menu__header")).toContainText("Ana Contadora");
  await expect(page.locator(".user-menu__header")).toContainText("Contador/a");
  await expect(page.locator(".user-menu__header")).toContainText("ana@example.com");
  // No se sale del sidebar (que lo recortaría).
  const popupBox = await page.locator(".user-menu__popup").boundingBox();
  const sidebarBox = await page.locator(".sidebar").boundingBox();
  expect(popupBox.x + popupBox.width).toBeLessThanOrEqual(sidebarBox.x + sidebarBox.width);
  await expectNoSeriousA11yViolations(page, testInfo, "menu-abierto");

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Salir" })).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("menuitem", { name: "Mi perfil" })).toBeFocused();

  // Escape cierra y devuelve el foco al botón.
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // Un clic fuera también cierra.
  await button.click();
  await expect(menu).toBeVisible();
  await page.getByRole("heading", { name: "Tus clientes" }).click();
  await expect(menu).toBeHidden();
  await expect(button).toHaveAttribute("aria-expanded", "false");

  // Mi perfil.
  await button.click();
  await page.getByRole("menuitem", { name: "Mi perfil" }).click();
  await expect(page.getByRole("heading", { name: "Mi perfil" })).toBeVisible();
  await expect(page.locator(".profile-data")).toContainText("ana@example.com");
  await expectNoSeriousA11yViolations(page, testInfo, "perfil");

  // El mismo menú está en esta pantalla también: Salir.
  await page.getByRole("button", { name: /menú de la cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Salir" }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await expect(page.locator(".toast", { hasText: "Cerraste sesión." })).toBeVisible();
});

test("sin conexión, el menú de usuario del sidebar sigue visible completo", async ({ page, context }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await login(page, USERS.accountant);
  await context.setOffline(true);
  await expect(page.locator(".connectivity-banner")).toBeVisible();
  const button = page.getByRole("button", { name: /menú de la cuenta/ });
  const box = await button.boundingBox();
  expect(box.y + box.height, "el botón del menú queda dentro de la ventana").toBeLessThanOrEqual(720);
  await button.click();
  await expect(page.getByRole("menu")).toBeVisible();
  await context.setOffline(false);
});

test("menú de usuario en móvil: abre hacia abajo, completo y sin recortes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 375, height: 740 });
  await login(page, USERS.accountant);
  await page.getByRole("button", { name: /menú de la cuenta/ }).click();
  const menu = page.locator(".user-menu__popup");
  await expect(menu).toBeVisible();
  const box = await menu.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(375);
  // Cada opción recibe el clic en su centro (si el sidebar la recortara, no).
  for (const name of ["Mi perfil", "Salir"]) {
    const item = page.getByRole("menuitem", { name });
    const b = await item.boundingBox();
    const hit = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.textContent?.trim(), {
      x: b.x + b.width / 2,
      y: b.y + b.height / 2,
    });
    expect(hit).toBe(name);
  }
  await expectNoSeriousA11yViolations(page, testInfo, "menu-movil");
});

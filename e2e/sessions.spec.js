import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { createAccountByInvitation, loginThroughUi } from "./helpers.js";

/**
 * Sesiones activas (B13) en Chrome: la misma cuenta abierta en dos
 * "dispositivos" (contextos con distinto User-Agent). Desde uno se ven las
 * dos con ubicación aproximada, IP recortada y equipo; cerrar la otra la
 * saca AL INSTANTE; "cerrar todas las demás" pide confirmación.
 */
const PHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

async function openSecurity(page) {
  await page.goto("/#/seguridad");
  await expect(page.getByRole("heading", { name: "Sesiones activas" })).toBeVisible();
  await expect(page.locator("#sessions .session").first()).toBeVisible();
}

test("ver las sesiones, cerrar la del otro dispositivo y luego todas las demás", async ({
  page,
  browser,
}, testInfo) => {
  const account = await createAccountByInvitation({ name: "Sesiones E2E" });
  await loginThroughUi(page, account);

  const phone = await (await browser.newContext({ userAgent: PHONE_UA })).newPage();
  await loginThroughUi(phone, account);

  await openSecurity(page);
  const sessions = page.locator("#sessions .session");
  // La de la activación por invitación (API), este navegador y el "teléfono".
  await expect(sessions).toHaveCount(3);
  const current = sessions.filter({ hasText: "Esta sesión" });
  await expect(current).toHaveCount(1);
  // La etiqueta corta del equipo, en el sistema donde corra la prueba (Windows en local,
  // Linux en CI), y nunca la cadena larga del navegador.
  await expect(current.locator(".session__device")).toHaveText(/^Chrome en (Windows|Linux|macOS) Esta sesión$/);
  await expect(current).not.toContainText("Mozilla/5.0");
  await expect(current).toContainText("Ubicación aproximada");
  await expect(current).toContainText("Red local"); // el stack E2E corre en esta máquina
  // La IP recortada (sin el último octeto, o el /48 en IPv6), venga de la red que venga
  // (loopback en local y en CI, la red de Docker si el navegador corre en un contenedor).
  await expect(current).toContainText(/(?<!\d)\d{1,3}\.\d{1,3}\.\d{1,3}\.x\b|[0-9a-f:]*:\/48/);
  await expect(current.getByRole("button")).toHaveCount(0);
  const phoneRow = sessions.filter({ hasText: "Safari en iOS" });
  await expect(phoneRow).toHaveCount(1);
  await expectNoSeriousA11yViolations(page, testInfo, "sesiones-activas");

  // Cerrar la del teléfono: el teléfono queda fuera en su siguiente acción.
  await phoneRow.getByRole("button", { name: "Cerrar la sesión de Safari en iOS" }).click();
  await expect(page.locator(".toast", { hasText: "Cerraste esa sesión." })).toBeVisible();
  await expect(sessions).toHaveCount(2);
  await expect(page.getByRole("heading", { name: "Sesiones activas" })).toBeFocused();
  await phone.reload();
  await expect(phone.locator("#login-form")).toBeVisible();

  // Cerrar todas las demás (queda la de la invitación): confirmación primero.
  await page.getByRole("button", { name: "Cerrar todas las demás sesiones" }).click();
  const dialog = page.getByRole("dialog", { name: "¿Cerrar las demás sesiones?" });
  await expect(dialog).toContainText("Se cerrará 1 sesión en otro dispositivo. Esta sigue abierta.");
  await expectNoSeriousA11yViolations(page, testInfo, "sesiones-confirmar");
  await dialog.getByRole("button", { name: "Volver" }).click();
  await expect(page.getByRole("button", { name: "Cerrar todas las demás sesiones" })).toBeFocused();
  await expect(sessions).toHaveCount(2);

  await page.getByRole("button", { name: "Cerrar todas las demás sesiones" }).click();
  await dialog.getByRole("button", { name: "Cerrar las demás" }).click();
  await expect(page.locator(".toast", { hasText: "Cerraste 1 sesión." })).toBeVisible();
  await expect(sessions).toHaveCount(1);
  await expect(page.getByText("No hay otras sesiones abiertas.")).toBeVisible();

  // Esta sesión sigue funcionando.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Sesiones activas" })).toBeVisible();
  await phone.close();
});

test("móvil: la lista de sesiones cabe sin desborde horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginThroughUi(page, await createAccountByInvitation({ name: "Sesiones Movil" }));
  await openSecurity(page);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
});

import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import {
  createAccountByInvitation,
  loginThroughUi,
  outboxCount,
  resetTokenFor,
} from "./helpers.js";

/**
 * Recuperación de contraseña de punta a punta (B7): "Olvidé mi contraseña"
 * → correo (email_outbox) → "Nueva contraseña" → todas las sesiones de la
 * cuenta se cierran, también la de otro dispositivo que ya estaba abierta.
 */

const NEW_PASSWORD = "otra frase nueva y larga";

async function requestReset(page, email) {
  await page.goto("/#/login");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recupera tu acceso" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  const status = page.getByRole("status").filter({ hasText: "Revisa tu correo" });
  await expect(status).toBeVisible();
  return status.textContent();
}

test("olvidé mi contraseña → enlace del correo → contraseña nueva; se cierran todas las sesiones", async ({
  page,
  browser,
}, testInfo) => {
  const account = await createAccountByInvitation({ name: "Recupera E2E" });

  // Otro dispositivo con la sesión abierta.
  const other = await (await browser.newContext()).newPage();
  await loginThroughUi(other, account);

  // Pedir el enlace. La pantalla dice lo mismo para un correo que no existe.
  const forExisting = await requestReset(page, account.email);
  await expectNoSeriousA11yViolations(page, testInfo, "olvide-mi-contrasena-enviado");
  const forMissing = await requestReset(page, `nadie-${Date.now()}@test.local`);
  expect(forMissing).toBe(forExisting);

  // Abrir el enlace del correo: el token sale de la barra de direcciones.
  const token = await resetTokenFor(account.email);
  await page.goto(`/#/restablecer/${token}`);
  await expect(page.getByRole("heading", { name: "Crea una contraseña nueva" })).toBeVisible();
  await expect(page).toHaveURL(/#\/restablecer$/);
  expect(page.url()).not.toContain(token.split(".")[0]);
  await expectNoSeriousA11yViolations(page, testInfo, "nueva-contrasena");

  await page.getByLabel("Contraseña nueva", { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel("Repite la contraseña nueva").fill(NEW_PASSWORD);
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.locator(".toast", { hasText: "se cerraron todas tus sesiones" })).toBeVisible();
  await expect(page).toHaveURL(/#\/login$/);

  // El otro dispositivo pierde la sesión en su siguiente petición.
  await other.reload();
  await expect(other.locator("#login-form")).toBeVisible();

  // La contraseña anterior ya no sirve; la nueva sí.
  await page.locator("#login-form").getByLabel("Correo").fill(account.email);
  await page.locator("#login-form").getByLabel("Contraseña").fill(account.password);
  await page.locator("#login-form").getByRole("button", { name: "Entrar" }).click();
  await expect(page.locator(".toast--error")).toBeVisible();
  await expect(page.locator("#login-form")).toBeVisible();
  await loginThroughUi(page, { email: account.email, password: NEW_PASSWORD });

  // El mismo enlace ya no sirve, y ofrece pedir otro.
  await page.goto(`/#/restablecer/${token}`);
  const invalid = page.getByRole("alert").filter({ hasText: "no es válido o ya venció" });
  await expect(invalid).toBeVisible();
  await expect(invalid.getByRole("link", { name: "Pedir un enlace nuevo" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "enlace-restablecer-invalido");
});

test("dentro del minuto, pedir otro enlace no manda otro correo (la pantalla responde igual)", async ({ page }) => {
  const account = await createAccountByInvitation({ name: "Reintenta E2E" });
  await requestReset(page, account.email);
  await resetTokenFor(account.email);
  await requestReset(page, account.email);
  // Da tiempo al procesamiento diferido del segundo pedido antes de contar.
  await page.waitForTimeout(500);
  expect(await outboxCount(account.email, "password_reset")).toBe(1);
});

import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import {
  createAdminWithMfa,
  inviteByApi,
  invitationTokenFor,
  NEW_ACCOUNT_PASSWORD,
} from "./helpers.js";
import { totpCode } from "./totp.js";

/**
 * Verificación en dos pasos en Chrome (B9): un admin nuevo queda obligado a
 * activarla y la activa desde "Seguridad" SIN celular (el código se calcula
 * con la clave que muestra la pantalla, como en la guía de demo); y el login
 * en dos pasos, con código de la app o de recuperación.
 */

test("admin nuevo: tras activar su cuenta solo puede estar en Seguridad hasta activar MFA", async ({
  page,
}, testInfo) => {
  const email = await inviteByApi({ name: "Admin Obligada", role: "admin" });
  await page.goto(`/#/invitacion/${await invitationTokenFor(email)}`);
  await expect(page.getByText("Luego activarás la verificación en dos pasos")).toBeVisible();
  await page.getByLabel("Contraseña", { exact: true }).fill(NEW_ACCOUNT_PASSWORD);
  await page.getByLabel("Repite la contraseña").fill(NEW_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Activar mi cuenta" }).click();

  // El guard la lleva a Seguridad con un aviso, y no la deja salir de ahí.
  await expect(page.getByRole("heading", { name: "Seguridad", level: 1 })).toBeVisible();
  await expect(page).toHaveURL(/#\/seguridad$/);
  await expect(page.getByRole("alert").filter({ hasText: "primero debes activar" })).toBeVisible();
  await page.evaluate(() => (window.location.hash = "#/admin/users"));
  await expect(page).toHaveURL(/#\/seguridad$/);
  await expectNoSeriousA11yViolations(page, testInfo, "seguridad-obligatoria");

  await page.getByLabel("Confirma tu contraseña actual").fill(NEW_ACCOUNT_PASSWORD);
  await page.getByRole("button", { name: "Empezar" }).click();
  const qr = page.getByRole("img", { name: /Código QR/ });
  await expect(qr).toBeVisible();
  expect(await qr.evaluate((img) => img.naturalWidth > 0)).toBe(true); // el SVG del servidor se dibuja
  await expectNoSeriousA11yViolations(page, testInfo, "seguridad-qr");

  // Sin celular: el código se calcula con la clave que muestra la pantalla.
  const secret = await page.locator("#mfa-secret").textContent();
  await page.getByLabel("Código de 6 dígitos de la app").fill(totpCode(secret));
  await page.getByRole("button", { name: "Activar" }).click();
  await expect(page.locator("#mfa-codes li")).toHaveCount(10);
  await expectNoSeriousA11yViolations(page, testInfo, "seguridad-codigos");

  // "Listo" exige confirmar que los guardó.
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.locator("#mfa-codes")).toBeVisible();
  await page.getByLabel("Los guardé en un lugar seguro").check();
  await page.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByText("Activa", { exact: true })).toBeVisible();
  await expect(page.getByText("no se puede desactivar")).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "seguridad-activa");

  // Ya puede usar el resto de la app con la MISMA sesión.
  await page.getByRole("link", { name: "Usuarios" }).click();
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
});

test("login en dos pasos: código incorrecto, luego un código de recuperación", async ({ page }, testInfo) => {
  const admin = await createAdminWithMfa({ name: "Admin Dos Pasos" });
  await page.goto("/#/login");
  const form = page.locator("#login-form");
  await form.getByLabel("Correo").fill(admin.email);
  await form.getByLabel("Contraseña").fill(admin.password);
  await form.getByRole("button", { name: "Entrar" }).click();

  await expect(page.getByRole("heading", { name: "Verificación en dos pasos" })).toBeVisible();
  const code = page.getByLabel("Código de la app");
  await expect(code).toBeFocused();
  await expect(code).toHaveAttribute("autocomplete", "one-time-code");
  await expectNoSeriousA11yViolations(page, testInfo, "login-segundo-paso");

  const wrong = totpCode(admin.mfaSecret) === "000000" ? "111111" : "000000";
  await code.fill(wrong);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.locator("#mfa-error")).toHaveText("El código no es correcto.");

  await page.getByRole("button", { name: "Usar un código de recuperación" }).click();
  await page.getByLabel("Código de recuperación").fill(admin.recoveryCodes[0]);
  await page.getByRole("button", { name: "Verificar" }).click();
  await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
});

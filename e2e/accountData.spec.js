import fs from "node:fs";
import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { createAccountByInvitation, loginThroughUi } from "./helpers.js";

/**
 * "Tus datos" en Mi perfil (B14), en Chrome: descargar el JSON de verdad,
 * eliminar la cuenta (confirmación, sesión cerrada, no se puede volver a
 * entrar) y el contador con clientes, que no puede eliminarla.
 */

async function openAccountData(page) {
  await page.goto("/#/profile");
  await expect(page.getByRole("heading", { name: "Tus datos" })).toBeVisible();
}

test("descargar mis datos: un .json con la cuenta", async ({ page }) => {
  const account = await createAccountByInvitation({ name: "Exporta E2E" });
  await loginThroughUi(page, account);
  await openAccountData(page);
  const form = page.locator("#export-form");
  await form.getByLabel("Confirma tu contraseña actual").fill(account.password);
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    form.getByRole("button", { name: "Descargar mis datos" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/^renta-ia-mis-datos-\d{4}-\d{2}-\d{2}\.json$/);
  const data = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  expect(data.format).toBe("renta-ia-export-v1");
  expect(data.account).toMatchObject({ email: account.email, name: "Exporta E2E" });
  await expect(page.locator(".toast", { hasText: "Descargamos tus datos." })).toBeVisible();
});

test("eliminar mi cuenta: confirmación, sesión cerrada y no se puede volver a entrar", async ({ page }, testInfo) => {
  const account = await createAccountByInvitation({ name: "Elimina E2E" });
  await loginThroughUi(page, account);
  await openAccountData(page);
  await expectNoSeriousA11yViolations(page, testInfo, "tus-datos");

  const form = page.locator("#delete-form");
  await form.getByLabel("Contraseña actual").fill(account.password);
  await form.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await expect(page.locator("#delete-error")).toContainText("Marca la casilla");
  await form.getByLabel("Entiendo que no se puede deshacer").check();
  await form.getByRole("button", { name: "Eliminar mi cuenta" }).click();

  const dialog = page.getByRole("dialog", { name: "¿Eliminar tu cuenta?" });
  await expect(dialog).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "eliminar-confirmar");
  await dialog.getByRole("button", { name: "Volver" }).click();
  await expect(form.getByRole("button", { name: "Eliminar mi cuenta" })).toBeFocused();

  await form.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await dialog.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await expect(page.locator("#login-form")).toBeVisible();
  await expect(page.locator(".toast", { hasText: "Eliminamos tu cuenta." })).toBeVisible();

  // Con el correo anterior ya no se entra; recargar tampoco recupera la sesión.
  await page.reload();
  await expect(page.locator("#login-form")).toBeVisible();
  const login = page.locator("#login-form");
  await login.getByLabel("Correo").fill(account.email);
  await login.getByLabel("Contraseña").fill(account.password);
  await login.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByText("Credenciales inválidas").first()).toBeVisible();
});

test("un contador con clientes ve por qué no puede eliminar su cuenta", async ({ page }) => {
  const account = await createAccountByInvitation({ name: "Con Clientes E2E" });
  await loginThroughUi(page, account);
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  const clientForm = page.locator("#new-client-form");
  await clientForm.getByLabel("Nombre completo").fill("Cliente E2E");
  await clientForm.getByLabel("Cédula o NIT").fill(`E2E-${Date.now()}`);
  await clientForm.getByRole("button", { name: "Guardar cliente" }).click();
  await expect(page.getByRole("link", { name: /Ver detalle de Cliente E2E/ })).toBeVisible();

  await openAccountData(page);
  await expect(page.locator("#delete-blocked")).toHaveText(/Tienes 1 cliente a tu cargo/);
  await expect(page.locator("#delete-form")).toHaveCount(0);
});

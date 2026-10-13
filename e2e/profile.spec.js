import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { createAccountByInvitation, emailChangeTokenFor, loginThroughUi, NEW_ACCOUNT_PASSWORD } from "./helpers.js";

/**
 * "Mi perfil" en Chrome (B11): editar nombre y teléfono, cambiar el correo
 * confirmándolo desde el enlace (otro navegador, sin sesión) y cambiar la
 * contraseña cerrando la sesión del otro dispositivo.
 */

const newEmail = () => `e2e-nuevo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;

async function openProfile(page) {
  await page.getByRole("button", { name: /menú de la cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Mi perfil" }).click();
  await expect(page.getByRole("heading", { name: "Mi perfil", level: 1 })).toBeVisible();
}

test("nombre y teléfono; cambio de correo confirmado desde el enlace", async ({ page, browser }, testInfo) => {
  const account = await createAccountByInvitation({ name: "Perfil E2E" });
  await loginThroughUi(page, account);
  await openProfile(page);
  await expectNoSeriousA11yViolations(page, testInfo, "perfil");

  const data = page.locator("#profile-form");
  await data.getByLabel("Nombre completo").fill("Perfil E2E Editado");
  await data.getByLabel("Teléfono").fill("+57 300 123 4567");
  await data.getByRole("button", { name: "Guardar" }).click();
  await expect(page.locator(".toast", { hasText: "Guardamos tus datos" })).toBeVisible();
  await expect(page.getByRole("button", { name: /menú de la cuenta/ })).toContainText("Perfil E2E Editado");

  // Cambio de correo: la contraseña incorrecta se rechaza junto al formulario.
  const email = page.locator("#email-form");
  const target = newEmail();
  await email.getByLabel("Correo nuevo").fill(target);
  await email.getByLabel("Contraseña actual").fill("no es la contraseña");
  await email.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.locator("#email-error")).toHaveText("La contraseña actual no es correcta.");
  await email.getByLabel("Contraseña actual").fill(account.password);
  await email.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.locator("#profile-pending")).toContainText(target);
  await expect(page.locator("#profile-email")).toHaveText(account.email); // todavía no cambia

  // El enlace se abre en otro navegador, sin sesión.
  const other = await (await browser.newContext()).newPage();
  const token = await emailChangeTokenFor(target);
  await other.goto(`/#/confirmar-correo/${token}`);
  await expect(other.getByText("Listo: tu correo cambió.")).toBeVisible();
  await expect(other).toHaveURL(/#\/confirmar-correo$/);
  expect(other.url()).not.toContain(token.split(".")[0]);
  await expectNoSeriousA11yViolations(other, testInfo, "confirmar-correo");
  // Y entra con el correo nuevo.
  await loginThroughUi(other, { email: target, password: account.password });

  await page.reload();
  await expect(page.locator("#profile-email")).toHaveText(target);
});

test("cambiar la contraseña cierra la sesión del otro dispositivo", async ({ page, browser }) => {
  const account = await createAccountByInvitation({ name: "Clave E2E" });
  const other = await (await browser.newContext()).newPage();
  await loginThroughUi(other, account);
  await loginThroughUi(page, account);
  await openProfile(page);

  const form = page.locator("#password-form");
  const fresh = "caballo azul bateria grapa nueva";
  await form.getByLabel("Contraseña actual").fill(NEW_ACCOUNT_PASSWORD);
  await form.getByLabel("Contraseña nueva", { exact: true }).fill(fresh);
  await form.getByLabel("Repite la contraseña nueva").fill(fresh);
  await form.getByRole("button", { name: "Cambiar contraseña" }).click();
  // 2: la del otro dispositivo y la que abrió la activación de la cuenta (helper por API).
  await expect(page.locator(".toast", { hasText: "cerramos 2 sesiones más" })).toBeVisible();

  // Esta sesión sigue; la del otro dispositivo, no.
  await page.reload();
  await expect(page.getByRole("heading", { name: "Mi perfil", level: 1 })).toBeVisible();
  await other.reload();
  await expect(other.locator("#login-form")).toBeVisible();
});

import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { API } from "./config.js";
import { createAccountByInvitation, createAdminWithMfa, loginThroughUi } from "./helpers.js";

/**
 * Reasignar clientes (Usuarios, admin) en Chrome: el admin pasa los clientes
 * de un contador a otro; el que los recibe los ve, y el anterior ya puede
 * eliminar su cuenta.
 */
test("el admin reasigna los clientes; el destino los ve y el origen ya puede eliminar su cuenta", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const stamp = Date.now();
  const from = await createAccountByInvitation({ name: `Origen ${stamp}` });
  const to = await createAccountByInvitation({ name: `Destino ${stamp}` });
  const created = await request.post(`${API}/api/clients`, {
    headers: { Authorization: `Bearer ${from.accessToken}` },
    data: { fullName: `Cliente Reasignado ${stamp}`, documentNumber: `E2E-${stamp}` },
  });
  expect(created.status()).toBe(201);

  const admin = await createAdminWithMfa({ name: "Admin Reasigna" });
  await loginThroughUi(page, admin);
  await page.goto("/#/admin/users");
  const section = page.getByRole("region", { name: "Reasignar clientes" });
  await expect(section.getByLabel("Contador de origen")).toBeVisible();
  await section.getByLabel("Contador de origen").selectOption({ label: `Origen ${stamp} · ${from.email} (1 cliente)` });
  await section
    .getByLabel("Contador de destino")
    .selectOption({ label: `Destino ${stamp} · ${to.email} (0 clientes)` });
  // Opciones largas (nombre · correo): ni el select ni la página se salen del ancho.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(
    0
  );
  await section.getByRole("button", { name: "Reasignar" }).click();

  const dialog = page.getByRole("dialog", { name: "¿Reasignar los clientes?" });
  await expect(dialog).toContainText(
    `El cliente de Origen ${stamp} · ${from.email} pasará a Destino ${stamp} · ${to.email}.`
  );
  await expectNoSeriousA11yViolations(page, testInfo, "reasignar-confirmar");
  await dialog.getByRole("button", { name: "Reasignar" }).click();
  await expect(page.locator(".toast", { hasText: "Reasignaste 1 cliente." })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Reasignar clientes" })).toBeFocused();
  await expectNoSeriousA11yViolations(page, testInfo, "usuarios-reasignar");

  // El destino ve al cliente.
  const toPage = await (await browser.newContext()).newPage();
  await loginThroughUi(toPage, to);
  await expect(toPage.getByRole("link", { name: `Ver detalle de Cliente Reasignado ${stamp}` })).toBeVisible();

  // El origen ya puede eliminar su cuenta (sin el aviso de clientes a cargo).
  const fromPage = await (await browser.newContext()).newPage();
  await loginThroughUi(fromPage, from);
  await fromPage.goto("/#/profile");
  await expect(fromPage.getByRole("heading", { name: "Tus datos" })).toBeVisible();
  await expect(fromPage.locator("#delete-form")).toBeVisible();
  await expect(fromPage.locator("#delete-blocked")).toHaveCount(0);
});

import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { API } from "./config.js";
import { createAccountByInvitation, createAdminWithMfa, loginThroughUi } from "./helpers.js";

/**
 * Densidad de las tablas (B15) en Chrome: la preferencia es de la CUENTA
 * (se elige en una sesión y llega a otra sesión, en otro contexto del
 * navegador) y vale para todas las tablas. Y en móvil ninguna pantalla con
 * tablas desborda horizontalmente.
 */

// Una celda de datos (no la fila "Cargando…" del principio, que no tiene relleno).
const cellPadding = (page, selector) =>
  page
    .locator(selector)
    .first()
    .evaluate((td) => parseFloat(getComputedStyle(td).paddingTop));
/** Celdas de tarjeta cuyo contenido no cabe (se cortaría aunque la página no desborde). */
const clippedCells = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".table--stack td")]
      .filter((td) => td.scrollWidth > td.clientWidth + 1)
      .map((td) => `${td.dataset.label}: ${td.textContent.trim().slice(0, 40)}`)
  );
const pageOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

/** Cliente creado por la API con la sesión de la cuenta (para tener la tabla de Documentos). */
async function createClientFor(request, accessToken, fullName) {
  const res = await request.post(`${API}/api/clients`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: { fullName, documentNumber: `E2E-${Date.now()}` },
  });
  expect(res.status()).toBe(201);
  return res.json();
}

test("la densidad elegida viaja con la cuenta: otro contexto del navegador la recibe al entrar", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const account = await createAccountByInvitation({ name: "Densidad E2E" });
  const client = await createClientFor(request, account.accessToken, "Cliente Densidad");
  await loginThroughUi(page, account);

  const selector = page.getByRole("group", { name: "Densidad de la tabla" });
  await expect(selector.getByLabel("Cómoda")).toBeChecked();
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
  const comfortable = await cellPadding(page, "#clients-tbody td[data-label]");
  await expectNoSeriousA11yViolations(page, testInfo, "clientes-con-selector");

  await selector.getByLabel("Compacta").check();
  await expect(page.locator("html")).toHaveAttribute("data-density", "compact");
  expect(await cellPadding(page, "#clients-tbody td[data-label]")).toBeLessThan(comfortable);
  // Se guardó en la cuenta: recargar (la sesión se recupera del servidor) la conserva.
  await page.waitForResponse((r) => r.url().endsWith("/api/users/me") && r.request().method() === "PATCH");
  await page.reload();
  await expect(page.getByRole("group", { name: "Densidad de la tabla" }).getByLabel("Compacta")).toBeChecked();

  // Otro contexto del navegador (sin cookies ni estado del primero): entra y ya está compacta.
  const other = await (await browser.newContext()).newPage();
  await loginThroughUi(other, account);
  await expect(other.locator("html")).toHaveAttribute("data-density", "compact");
  await expect(other.getByRole("group", { name: "Densidad de la tabla" }).getByLabel("Compacta")).toBeChecked();
  // Y vale para todas las tablas: Documentos del cliente también.
  await other.goto(`/#/clients/${client.id}`);
  const documentsTab = other.getByRole("tab", { name: /Documentos/ });
  if (await documentsTab.count()) await documentsTab.click();
  await expect(
    other.locator("#documents-table").locator("xpath=preceding-sibling::div[1]").getByLabel("Compacta")
  ).toBeChecked();
  await expectNoSeriousA11yViolations(other, testInfo, "documentos-compacta");

  // Volver a cómoda desde el otro contexto: el primero la recibe al recargar.
  await other.getByRole("group", { name: "Densidad de la tabla" }).first().getByLabel("Cómoda").check();
  await other.waitForResponse((r) => r.url().endsWith("/api/users/me") && r.request().method() === "PATCH");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-density", "comfortable");
});

test.describe("móvil (375 px): ninguna pantalla con tablas desborda", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Clientes y el detalle (contador), en tarjetas y sin desborde", async ({ page }, testInfo) => {
    await loginThroughUi(page, { email: "ana@example.com", password: "Password123!" });
    await expect(page.locator("#clients-tbody td[data-label]").first()).toBeVisible();
    expect(await pageOverflow(page)).toBe(0);
    expect(await clippedCells(page)).toEqual([]);
    // En tarjetas: el encabezado de la tabla no se ve y cada valor muestra su etiqueta.
    await expect(page.locator("table.table--stack thead")).toHaveCSS("position", "absolute");
    const label = await page
      .locator("#clients-tbody td[data-label]")
      .first()
      .evaluate((td) => getComputedStyle(td, "::before").content);
    expect(label).toBe('"Cliente"');
    await expectNoSeriousA11yViolations(page, testInfo, "clientes-movil");

    await page
      .getByRole("link", { name: /Ver detalle de/ })
      .first()
      .click();
    const tabs = page.getByRole("tab");
    await expect(tabs.first()).toBeVisible();
    for (let i = 0; i < (await tabs.count()); i++) {
      await tabs.nth(i).click();
      await page.waitForTimeout(300);
      expect(await pageOverflow(page), await tabs.nth(i).textContent()).toBe(0);
    }
  });

  test("Clientes (admin, con la columna Contador), Usuarios y Rendimiento sin desborde", async ({ page }, testInfo) => {
    const admin = await createAdminWithMfa({ name: "Admin Móvil" });
    await loginThroughUi(page, admin);
    await expect(page.locator("#clients-tbody tr").first()).toBeVisible();
    expect(await pageOverflow(page)).toBe(0);

    await page.goto("/#/admin/users");
    await expect(page.getByRole("heading", { name: "Invitaciones pendientes" })).toBeVisible();
    await expect(page.locator("#invitations-table tbody tr").first()).toBeVisible();
    expect(await pageOverflow(page)).toBe(0);
    expect(await clippedCells(page)).toEqual([]);
    await expectNoSeriousA11yViolations(page, testInfo, "usuarios-movil");

    await page.goto("/#/performance");
    await expect(page.locator("#perf-table")).not.toHaveAttribute("aria-busy", "true");
    expect(await pageOverflow(page)).toBe(0);
    // La tabla de cifras se desplaza dentro de su región, que se alcanza con el teclado.
    const region = page.getByRole("region", { name: "Percentil 75 de cada métrica por ruta" });
    await expect(region).toHaveAttribute("tabindex", "0");
    await expectNoSeriousA11yViolations(page, testInfo, "rendimiento-movil");
  });
});

import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { createAccountByInvitation, loginThroughUi } from "./helpers.js";
import { certificatePdf } from "./pdf.js";

/**
 * Flujo crítico, de punta a punta y sin atajos por la API:
 * cuenta invitada (sin registro público) → login → crear cliente → subir documento → ver el cambio de estado EN
 * TIEMPO REAL (WebSocket, sin recargar) → alerta → resumen → chat.
 * La IA es simulada (AI_PROVIDER=mock): sus respuestas llevan la marca
 * "[Respuesta simulada · ...]".
 */

test("invitación → login → cliente → documento en tiempo real → alerta → resumen → chat", async ({
  page,
}, testInfo) => {

  // --- Cuenta por invitación + login ---
  await page.goto("/#/login");
  await expect(page.getByRole("heading", { name: "Inicia sesión", level: 1 })).toBeVisible();
  // Sin registro público: no hay pestaña ni botón "Crear cuenta".
  await expect(page.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /crear cuenta/i })).toHaveCount(0);
  await expectNoSeriousA11yViolations(page, testInfo, "login");

  await loginThroughUi(page, await createAccountByInvitation({ name: "Contadora E2E" }));
  // El token de acceso nunca queda en localStorage.
  const storage = await page.evaluate(() => JSON.stringify({ ...localStorage }));
  expect(storage).not.toMatch(/eyJ[\w-]+\.[\w-]+\./);
  await expectNoSeriousA11yViolations(page, testInfo, "dashboard");

  // --- Crear cliente ---
  await page.getByRole("button", { name: "Nuevo cliente" }).click();
  const clientForm = page.locator("#new-client-form");
  await clientForm.getByLabel("Nombre completo").fill("Cliente de Prueba E2E");
  await clientForm.getByLabel("Cédula o NIT").fill(`E2E-${Date.now()}`);
  await clientForm.getByRole("button", { name: "Guardar cliente" }).click();
  await page.getByRole("link", { name: /Ver detalle de Cliente de Prueba E2E/ }).click();
  await expect(page.getByRole("heading", { name: "Cliente de Prueba E2E" })).toBeVisible();

  // --- Tiempo real conectado (WebSocket) ---
  await expect(page.locator("#live-status")).toContainText("tiempo real");

  // --- Subir documento: ingresos 10.000.000 y deducciones 9.000.000 (90 % > 40 %) ---
  const upload = page.locator("#upload-form");
  await upload.getByLabel("Tipo de documento").selectOption("income_certificate");
  await upload.getByLabel(/Archivo/).setInputFiles({
    name: "certificado-e2e.pdf",
    mimeType: "application/pdf",
    buffer: certificatePdf(`e2e-${Date.now()}`),
  });
  await upload.getByRole("button", { name: "Subir y analizar con IA" }).click();

  // El estado cambia solo, sin recargar: En cola/Procesando → Procesado.
  const row = page.locator("#documents-tbody tr", { hasText: "certificado-e2e.pdf" });
  await expect(row).toContainText("Procesando");
  await expect(row).toContainText(/Procesado(?! con)/, { timeout: 30_000 });
  const navigations = await page.evaluate(() => performance.getEntriesByType("navigation").length);
  expect(navigations).toBe(1);

  // Los conceptos extraídos aparecen.
  await expect(page.locator("#concepts-table")).toContainText("Deducción");

  // --- Alerta (regla: deducciones > 40 % del ingreso bruto) ---
  await page.getByRole("tab", { name: "Alertas" }).click();
  await expect(page.locator("#panel-alerts")).toContainText(/deducciones reportadas/i);

  // --- Resumen ejecutivo ---
  await page.getByRole("tab", { name: "Resumen" }).click();
  await page.getByRole("button", { name: "Generar resumen" }).click();
  await expect(page.locator("#panel-summary")).toContainText("Respuesta simulada", { timeout: 30_000 });

  // --- Chat ---
  await page.getByRole("tab", { name: "Asistente IA" }).click();
  await page.getByLabel("Tu pregunta sobre este cliente").fill("¿Cuál fue el ingreso bruto reportado?");
  await page.getByRole("button", { name: "Preguntar" }).click();
  await expect(page.locator("#chat-log")).toContainText("Respuesta simulada", { timeout: 30_000 });

  await expectNoSeriousA11yViolations(page, testInfo, "detalle-cliente");
});

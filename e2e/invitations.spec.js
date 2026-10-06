import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { collectCspViolations, invitationTokenFor, loginThroughUi } from "./helpers.js";

/**
 * Alta por invitación de punta a punta, por la interfaz (B6): el admin
 * invita, reenvía y cancela desde "Usuarios"; la persona invitada activa su
 * cuenta en "Completa tu cuenta". El token solo viaja por correo
 * (email_outbox): nunca llega al navegador del admin.
 */

const SEED_ADMIN = { email: "admin@example.com", password: "Password123!" };
const newEmail = (tag) => `e2e-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.local`;

async function openUsers(page) {
  await page.getByRole("link", { name: "Usuarios" }).click();
  await expect(page.getByRole("heading", { name: "Usuarios", level: 1 })).toBeVisible();
}

async function inviteThroughUi(page, { name, email, role = "accountant" }) {
  const form = page.locator("#invite-form");
  await form.getByLabel("Nombre completo").fill(name);
  await form.getByLabel("Correo").fill(email);
  await form.getByLabel("Rol").selectOption(role);
  await form.getByRole("button", { name: "Enviar invitación" }).click();
  await expect(page.locator(".toast", { hasText: `Invitación enviada a ${email}` })).toBeVisible();
}

const row = (page, email) => page.locator("#invitations-tbody tr", { hasText: email });

test("el admin invita y la persona activa su cuenta; el token nunca llega al navegador del admin", async ({
  page,
  browser,
}, testInfo) => {
  const csp = await collectCspViolations(page);
  // Todo lo que el navegador del admin recibe de la API.
  const adminBodies = [];
  page.on("response", async (res) => {
    if (res.url().includes("/api/")) adminBodies.push(await res.text().catch(() => ""));
  });

  await loginThroughUi(page, SEED_ADMIN);
  await openUsers(page);
  await expectNoSeriousA11yViolations(page, testInfo, "usuarios");

  const email = newEmail("invitada");
  await inviteThroughUi(page, { name: "Invitada E2E", email });
  await expect(row(page, email)).toContainText("Pendiente");
  await expect(row(page, email)).toContainText("Vence");
  await expectNoSeriousA11yViolations(page, testInfo, "usuarios-con-invitacion");

  const token = await invitationTokenFor(email);
  for (const part of [token, ...token.split(".")]) {
    expect(adminBodies.join("\n"), "el token no llega en ninguna respuesta al admin").not.toContain(part);
    expect(await page.content(), "ni aparece en la página").not.toContain(part);
  }

  // --- La persona invitada, en otro navegador ---
  const invitee = await (await browser.newContext()).newPage();
  const inviteeCsp = await collectCspViolations(invitee);
  await invitee.goto(`/#/invitacion/${token}`);
  await expect(invitee.getByRole("heading", { name: "Completa tu cuenta" })).toBeVisible();
  await expect(invitee.getByText("Invitada E2E")).toBeVisible();
  // El token sale de la barra de direcciones apenas se lee.
  await expect(invitee).toHaveURL(/#\/invitacion$/);
  expect(invitee.url()).not.toContain(token.split(".")[0]);
  await expectNoSeriousA11yViolations(invitee, testInfo, "completa-tu-cuenta");

  await invitee.getByLabel("Contraseña", { exact: true }).fill("mi frase propia muy larga");
  const toggle = invitee.getByRole("button", { name: "Mostrar contraseña" }).first();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(invitee.getByLabel("Contraseña", { exact: true })).toHaveAttribute("type", "text");
  await invitee.getByLabel("Repite la contraseña").fill("mi frase propia muy larga");
  await invitee.getByRole("button", { name: "Activar mi cuenta" }).click();
  await expect(invitee.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
  await expect(invitee.locator(".toast", { hasText: "Tu cuenta está activa" })).toBeVisible();

  // El mismo enlace ya no sirve.
  await invitee.goto(`/#/invitacion/${token}`);
  await expect(invitee.getByRole("alert")).toContainText("no es válido o ya venció");
  await expectNoSeriousA11yViolations(invitee, testInfo, "enlace-invalido");
  expect(inviteeCsp).toEqual([]);

  // Del lado del admin, la cuenta activada ya no está pendiente.
  await page.reload();
  await openUsers(page);
  await expect(row(page, email)).toHaveCount(0);
  expect(csp).toEqual([]);
});

test("reenviar invalida el enlace anterior; cancelar pide confirmación y devuelve el foco", async ({
  page,
  browser,
}, testInfo) => {
  await loginThroughUi(page, SEED_ADMIN);
  await openUsers(page);
  const email = newEmail("reenvio");
  await inviteThroughUi(page, { name: "Reenvío E2E", email });
  const oldToken = await invitationTokenFor(email);

  await row(page, email)
    .getByRole("button", { name: /Reenviar/ })
    .click();
  await expect(page.locator(".toast", { hasText: "El anterior ya no sirve" })).toBeVisible();
  const newToken = await invitationTokenFor(email);
  expect(newToken).not.toBe(oldToken);

  const other = await browser.newPage();
  await other.goto(`/#/invitacion/${oldToken}`);
  await expect(other.getByRole("alert")).toContainText("no es válido o ya venció");
  await other.goto(`/#/invitacion/${newToken}`);
  await expect(other.getByLabel("Repite la contraseña")).toBeVisible();

  // Cancelar: diálogo modal; Escape lo cierra sin cancelar y el foco vuelve al botón.
  const cancel = row(page, email).getByRole("button", { name: /Cancelar/ });
  await cancel.click();
  const dialog = page.getByRole("dialog", { name: "¿Cancelar la invitación?" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Volver" })).toBeFocused();
  await expectNoSeriousA11yViolations(page, testInfo, "dialogo-cancelar");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(cancel).toBeFocused();
  await expect(row(page, email)).toHaveCount(1);

  await cancel.click();
  await dialog.getByRole("button", { name: "Cancelar invitación" }).click();
  await expect(page.locator(".toast", { hasText: `Invitación de ${email} cancelada.` })).toBeVisible();
  await expect(row(page, email)).toHaveCount(0);

  // El enlace de una invitación cancelada ya no sirve.
  await other.goto(`/#/invitacion/${newToken}`);
  await expect(other.getByRole("alert")).toContainText("no es válido o ya venció");
});

test("solo el admin ve y abre Usuarios: un asistente que escribe la URL rebota", async ({ page }) => {
  await loginThroughUi(page, { email: "luis@example.com", password: "Password123!" });
  await expect(page.getByRole("link", { name: "Usuarios" })).toHaveCount(0);
  await page.evaluate(() => (window.location.hash = "#/admin/users"));
  await expect(page).toHaveURL(/#\/$/);
  await expect(page.getByRole("alert")).toContainText('No tienes permiso para ver "Usuarios".');
});

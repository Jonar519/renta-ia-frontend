import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { collectCspViolations } from "./helpers.js";

/**
 * Login rediseñado (B10) en Chrome: formulario + flujo de ejemplo, en
 * escritorio y en móvil, ambos temas (axe), sin desborde horizontal y con la
 * etiqueta "Ejemplo" claramente visible. Solo necesita el frontend.
 */

const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("escritorio: el flujo de ejemplo a la izquierda, el formulario a la derecha", async ({ page }, testInfo) => {
  const csp = await collectCspViolations(page);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/login");
  const form = page.locator("#login-form");
  const hero = page.locator(".login__hero");
  await expect(page.getByRole("heading", { name: "Inicia sesión", level: 1 })).toBeVisible();
  const [formBox, heroBox] = [await form.boundingBox(), await hero.boundingBox()];
  expect(heroBox.x + heroBox.width).toBeLessThanOrEqual(formBox.x);
  expect(await noHorizontalScroll(page)).toBe(0);

  // "Ejemplo": visible, legible (≥ 14 px, seminegrita) y anunciado.
  const tag = page.getByText("Ejemplo", { exact: true });
  await expect(tag).toBeVisible();
  const style = await tag.evaluate((el) => {
    const s = getComputedStyle(el);
    return { size: parseFloat(s.fontSize), weight: Number(s.fontWeight) };
  });
  expect(style.size).toBeGreaterThanOrEqual(14);
  expect(style.weight).toBeGreaterThanOrEqual(600);
  await expect(page.getByRole("figure")).toContainText("datos ficticios");

  await expectNoSeriousA11yViolations(page, testInfo, "login-escritorio");
  expect(csp).toEqual([]);
});

test("móvil: primero el formulario, sin desborde horizontal; 'Mostrar contraseña' funciona", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/#/login");
  const formBox = await page.locator("#login-form").boundingBox();
  const heroBox = await page.locator(".login__hero").boundingBox();
  expect(formBox.y + formBox.height).toBeLessThanOrEqual(heroBox.y);
  expect(await noHorizontalScroll(page)).toBe(0);
  // También en los teléfonos más angostos (320 px, p. ej. iPhone SE).
  await page.setViewportSize({ width: 320, height: 640 });
  expect(await noHorizontalScroll(page)).toBe(0);
  await page.setViewportSize({ width: 375, height: 812 });

  const password = page.locator("#login-form").getByLabel("Contraseña");
  await password.fill("secreta");
  const toggle = page.getByRole("button", { name: "Mostrar contraseña" });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await expectNoSeriousA11yViolations(page, testInfo, "login-movil");
});

import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Login rediseñado (B10) en Chrome: formulario + composición de marca, en
 * escritorio y en móvil, ambos temas (axe), sin desborde horizontal. Solo
 * necesita el frontend.
 */

const noHorizontalScroll = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

test("escritorio: la composición de marca a la izquierda, el formulario a la derecha", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/#/login");
  const form = page.locator("#login-form");
  const hero = page.locator(".login__hero");
  await expect(page.getByRole("heading", { name: "Inicia sesión", level: 1 })).toBeVisible();
  const [formBox, heroBox] = [await form.boundingBox(), await hero.boundingBox()];
  expect(heroBox.x + heroBox.width).toBeLessThanOrEqual(formBox.x);
  expect(await noHorizontalScroll(page)).toBe(0);

  // Composición de marca: sin cifras y sin el violeta reservado para la IA.
  await expect(hero.getByText("La IA lee. Tú decides.")).toBeVisible();
  expect(await hero.textContent()).not.toMatch(/\d/);
  // Los violetas de IA, resueltos por el navegador, contra cada color usado en la composición.
  const violet = await hero.evaluate((el) => {
    const probe = document.createElement("span");
    document.body.append(probe);
    const ai = ["--ai-accent", "--tone-ai-fg", "--tone-ai-bg"].map((token) => {
      probe.style.color = `var(${token})`;
      return getComputedStyle(probe).color;
    });
    probe.remove();
    return [el, ...el.querySelectorAll("*")].flatMap((n) => {
      const s = getComputedStyle(n);
      return [s.color, s.backgroundColor, s.borderLeftColor, s.borderBottomColor].filter((c) => ai.includes(c));
    });
  });
  expect(violet).toEqual([]);

  await expectNoSeriousA11yViolations(page, testInfo, "login-escritorio");
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

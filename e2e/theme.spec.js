import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";

/**
 * Regla de tema: la app sigue el tema del sistema operativo con CSS puro y
 * cambia EN VIVO si el usuario cambia el tema mientras la app está abierta.
 * Se emula el cambio del sistema (prefers-color-scheme) sin recargar, y se
 * comprueba que la página no se recargó (marca en window que sobrevive) y
 * que no hay ningún control de tema en la interfaz.
 *
 * Solo necesita el frontend (pantalla de login): no depende de la API.
 */
test("el tema sigue al sistema operativo en vivo, sin recargar", async ({ page }, testInfo) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/");
  const card = page.locator(".auth-card");
  await expect(card).toBeVisible();

  await page.evaluate(() => (window.__sinRecargar = "marca"));
  const colors = () =>
    page.evaluate(() => ({
      body: getComputedStyle(document.body).backgroundColor,
      card: getComputedStyle(document.querySelector(".auth-card")).backgroundColor,
      scheme: getComputedStyle(document.documentElement).colorScheme,
    }));

  expect(await colors()).toEqual({ body: "rgb(244, 246, 248)", card: "rgb(255, 255, 255)", scheme: "light dark" });

  // El "sistema operativo" pasa a oscuro con la app abierta.
  await page.emulateMedia({ colorScheme: "dark" });
  await expect.poll(colors).toEqual({ body: "rgb(15, 26, 44)", card: "rgb(22, 35, 58)", scheme: "light dark" });

  // Y vuelve a claro.
  await page.emulateMedia({ colorScheme: "light" });
  await expect.poll(colors).toEqual({ body: "rgb(244, 246, 248)", card: "rgb(255, 255, 255)", scheme: "light dark" });

  expect(await page.evaluate(() => window.__sinRecargar), "la página no se recargó").toBe("marca");
  expect(await page.evaluate(() => performance.getEntriesByType("navigation").length)).toBe(1);

  // Sin selector de tema en ningún lado de la interfaz.
  await expect(page.getByRole("button", { name: /tema|oscuro|claro|theme|dark|light/i })).toHaveCount(0);
  await expect(page.getByRole("switch")).toHaveCount(0);

  await expectNoSeriousA11yViolations(page, testInfo, "login");
});

import { expect, test } from "@playwright/test";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { collectCspViolations, createAccountByInvitation, loginThroughUi } from "./helpers.js";

/**
 * Foto de perfil en Chrome (B12): recorte real con canvas (flechas, zoom),
 * subida, la foto en Mi perfil y en el menú (blob: permitido por la CSP),
 * persistencia al recargar y quitarla.
 */

/** PNG de 400×300 generado en el propio navegador (sin archivos binarios en el repo). */
async function makePng(page) {
  const base64 = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 300;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#1f3b57";
    ctx.fillRect(0, 0, 400, 300);
    ctx.fillStyle = "#f4f6f8";
    ctx.fillRect(150, 100, 100, 100);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  return { name: "foto.png", mimeType: "image/png", buffer: Buffer.from(base64, "base64") };
}

async function openProfile(page) {
  await page.getByRole("button", { name: /menú de la cuenta/ }).click();
  await page.getByRole("menuitem", { name: "Mi perfil" }).click();
  await expect(page.getByRole("heading", { name: "Foto de perfil" })).toBeVisible();
}

test("elegir, encuadrar y guardar la foto; se ve en el perfil y en el menú, y se puede quitar", async ({
  page,
}, testInfo) => {
  const csp = await collectCspViolations(page);
  await loginThroughUi(page, await createAccountByInvitation({ name: "Foto E2E" }));
  await openProfile(page);
  const menuAvatar = page.locator("[data-user-menu] .user-menu__avatar");
  await expect(menuAvatar).toHaveText("FE");

  // Un archivo que no es una imagen, aunque se llame .png: se avisa sin romper nada.
  await page.locator("#avatar-file").setInputFiles({
    name: "falsa.png",
    mimeType: "image/png",
    buffer: Buffer.from("no soy una imagen"),
  });
  await expect(page.locator("#avatar-error")).toHaveText("No se pudo leer la imagen. Elige otra.");

  await page.locator("#avatar-file").setInputFiles(await makePng(page));
  const canvas = page.getByRole("img", { name: "Vista previa de la foto recortada" });
  await expect(canvas).toBeFocused();
  await page.getByLabel("Zoom").fill("2");
  // Llevar el encuadre más allá del borde derecho de la foto (→ mueve el
  // encuadre, la foto se corre a la izquierda): el recorte se detiene en el
  // borde y nunca deja una franja vacía.
  await canvas.focus();
  for (let i = 0; i < 12; i++) await page.keyboard.press("Shift+ArrowRight");
  await expectNoSeriousA11yViolations(page, testInfo, "recortar-foto");
  await page.getByRole("button", { name: "Guardar foto" }).click();
  await expect(page.locator(".toast", { hasText: "Guardamos tu foto" })).toBeVisible();

  const profilePhoto = page.locator("#profile-photo img");
  await expect(profilePhoto).toHaveAttribute("src", /^blob:/);
  await expect(menuAvatar.locator("img")).toHaveAttribute("src", /^blob:/);
  expect(await profilePhoto.evaluate((img) => img.naturalWidth)).toBe(256); // reducida en el navegador
  // Ambos bordes de la foto guardada son la foto (azul oscuro), no un relleno blanco.
  const edges = await profilePhoto.evaluate((img) => {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const ctx = c.getContext("2d");
    ctx.drawImage(img, 0, 0);
    return [2, 253].map((x) => [...ctx.getImageData(x, 128, 1, 1).data.slice(0, 3)]);
  });
  for (const pixel of edges) expect(Math.max(...pixel), `píxel del borde: ${pixel}`).toBeLessThan(120);
  await expectNoSeriousA11yViolations(page, testInfo, "perfil-con-foto");

  // Se conserva al recargar (se vuelve a pedir con la sesión).
  await page.reload();
  await expect(page.locator("[data-user-menu] .user-menu__avatar img")).toHaveAttribute("src", /^blob:/);

  await page.getByRole("button", { name: "Quitar foto" }).click();
  await expect(page.locator(".toast", { hasText: "Quitaste tu foto" })).toBeVisible();
  await expect(page.locator("#profile-photo img")).toHaveCount(0);
  await expect(page.locator("[data-user-menu] .user-menu__avatar")).toHaveText("FE");
  expect(csp).toEqual([]);
});

test("móvil: el recorte cabe sin desborde horizontal", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await loginThroughUi(page, await createAccountByInvitation({ name: "Foto Movil" }));
  await page.goto("/#/profile");
  await page.locator("#avatar-file").setInputFiles(await makePng(page));
  await expect(page.getByRole("button", { name: "Guardar foto" })).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(overflow).toBe(0);
});

import { expect } from "@playwright/test";

/**
 * Registra en `violations` cada violación de la Content-Security-Policy de
 * la página (p. ej. un style="…" en línea, que la CSP bloquea).
 */
export async function collectCspViolations(page) {
  const violations = [];
  await page.exposeFunction("__reportCsp", (v) => violations.push(v));
  await page.addInitScript(() => {
    document.addEventListener("securitypolicyviolation", (e) =>
      window.__reportCsp(`${e.violatedDirective} ${e.blockedURI}`)
    );
  });
  return violations;
}

/** Cuenta nueva (sin clientes) y sesión iniciada, por la interfaz. */
export async function signUp(page, name = "Contadora E2E") {
  await page.goto("/#/login");
  await page.getByRole("tab", { name: "Crear cuenta" }).click();
  const register = page.locator("#register-form");
  await register.getByLabel("Nombre").fill(name);
  await register.getByLabel("Correo").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`);
  await register.getByLabel("Contraseña").fill("caballo correcto bateria grapa");
  await register.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
}

/** Marca que sobrevive mientras la página NO se recargue. */
export async function markNoReload(page) {
  await page.evaluate(() => (window.__sinRecargar = "marca"));
  return async () => {
    expect(await page.evaluate(() => window.__sinRecargar), "la página no se recargó").toBe("marca");
  };
}

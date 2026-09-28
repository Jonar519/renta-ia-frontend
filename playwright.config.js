import { defineConfig } from "@playwright/test";

/**
 * E2E del flujo crítico contra un stack REAL (API + worker + PostgreSQL +
 * Redis) con la IA simulada (AI_PROVIDER=mock en la API y el worker).
 * El frontend se sirve con `vite preview` del build (con su CSP), compilado
 * con VITE_API_URL apuntando a esa API. Ver e2e/README.md.
 */
export default defineConfig({
  testDir: "e2e",
  timeout: 90_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.E2E_BASE_URL || "http://localhost:4173",
    // En local se usa el Chrome instalado; en CI, el Chromium de Playwright.
    channel: process.env.CI ? undefined : "chrome",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "es-CO",
    // Sin transiciones (base.css respeta prefers-reduced-motion): axe mide el
    // contraste con la opacidad final y no a mitad de un fundido de un toast.
    reducedMotion: "reduce",
  },
});

import { expect, request } from "@playwright/test";
import pg from "pg";

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

// API y base del stack E2E (en CI: E2E_API_URL y DATABASE_URL del job).
const API = process.env.E2E_API_URL || "http://localhost:4100";
const DATABASE_URL =
  process.env.E2E_DATABASE_URL ||
  process.env.DATABASE_URL ||
  "postgresql://postgres:postgres@localhost:5433/renta_ia_e2e";
// Admin del seed (renta-ia-database/seed; el job de CI lo carga).
const SEED_ADMIN = { email: "admin@example.com", password: "Password123!" };
export const NEW_ACCOUNT_PASSWORD = "caballo correcto bateria grapa";

/** Último enlace de invitación enviado a ese correo, leído de la bandeja simulada (email_outbox). */
export async function invitationTokenFor(email) {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(
      "SELECT body_text FROM email_outbox WHERE to_address = $1 AND template = 'invitation' ORDER BY created_at DESC LIMIT 1",
      [email]
    );
    const token = rows[0]?.body_text?.match(/#\/invitacion\/([\w.-]+)/)?.[1];
    if (!token) throw new Error(`No hay invitación para ${email} en email_outbox`);
    return token;
  } finally {
    await db.end();
  }
}

/**
 * Cuenta nueva por el flujo real (no hay registro público): el admin del seed
 * invita por la API, el enlace se lee de email_outbox y la cuenta se activa
 * con su contraseña. Contexto HTTP propio: no comparte cookies con la página.
 */
export async function createAccountByInvitation({ name = "Contadora E2E", role = "accountant" } = {}) {
  const api = await request.newContext({ baseURL: API });
  try {
    const login = await api.post("/api/auth/login", { data: SEED_ADMIN });
    expect(login.status(), "login del admin del seed").toBe(200);
    const { accessToken } = await login.json();
    const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;
    const invited = await api.post("/api/admin/invitations", {
      headers: { Authorization: `Bearer ${accessToken}` },
      data: { name, email, role },
    });
    expect(invited.status(), "invitación").toBe(201);
    const accepted = await api.post("/api/auth/invitations/accept", {
      data: { token: await invitationTokenFor(email), password: NEW_ACCOUNT_PASSWORD },
    });
    expect(accepted.status(), "activación").toBe(200);
    return { email, password: NEW_ACCOUNT_PASSWORD };
  } finally {
    await api.dispose();
  }
}

/** Inicia sesión por la interfaz. */
export async function loginThroughUi(page, { email, password }) {
  await page.goto("/#/login");
  const form = page.locator("#login-form");
  await form.getByLabel("Correo").fill(email);
  await form.getByLabel("Contraseña").fill(password);
  await form.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Tus clientes" })).toBeVisible();
}

/** Cuenta nueva (sin clientes), creada por invitación, con la sesión iniciada en la interfaz. */
export async function signUp(page, name = "Contadora E2E") {
  await loginThroughUi(page, await createAccountByInvitation({ name }));
}

/** Marca que sobrevive mientras la página NO se recargue. */
export async function markNoReload(page) {
  await page.evaluate(() => (window.__sinRecargar = "marca"));
  return async () => {
    expect(await page.evaluate(() => window.__sinRecargar), "la página no se recargó").toBe("marca");
  };
}

import fs from "node:fs";
import { expect, request } from "@playwright/test";
import pg from "pg";
import { API, DATABASE_URL, SEED_ADMIN_FILE } from "./config.js";
import { totpCode } from "./totp.js";

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

export const NEW_ACCOUNT_PASSWORD = "caballo correcto bateria grapa";

/** Sesión del admin del seed, con MFA activo (la deja e2e/globalSetup.js). */
const seedAdminToken = () => JSON.parse(fs.readFileSync(SEED_ADMIN_FILE, "utf8")).accessToken;
const uniqueEmail = (tag = "e2e") => `${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@test.local`;

/** Invita por la API (como el admin del seed) y devuelve el correo. */
export async function inviteByApi({ name, role, email = uniqueEmail() }) {
  const api = await request.newContext({ baseURL: API });
  try {
    const invited = await api.post("/api/admin/invitations", {
      headers: { Authorization: `Bearer ${seedAdminToken()}` },
      data: { name, email, role },
    });
    expect(invited.status(), `invitación: ${await invited.text()}`).toBe(201);
    return email;
  } finally {
    await api.dispose();
  }
}

/**
 * Último token enviado a ese correo con esa plantilla, leído de la bandeja
 * simulada (email_outbox). La recuperación se procesa DESPUÉS de responder
 * (tiempo constante): por eso se espera a que llegue el correo.
 */
async function outboxTokenFor(email, template, linkPattern) {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    let token;
    await expect
      .poll(
        async () => {
          const { rows } = await db.query(
            "SELECT body_text FROM email_outbox WHERE to_address = $1 AND template = $2 ORDER BY created_at DESC LIMIT 1",
            [email, template]
          );
          token = rows[0]?.body_text?.match(linkPattern)?.[1];
          return Boolean(token);
        },
        { message: `correo '${template}' para ${email} en email_outbox`, timeout: 5000 }
      )
      .toBe(true);
    return token;
  } finally {
    await db.end();
  }
}

/** Último enlace de invitación enviado a ese correo. */
export const invitationTokenFor = (email) => outboxTokenFor(email, "invitation", /#\/invitacion\/([\w.-]+)/);

/** Último enlace para restablecer la contraseña enviado a ese correo. */
export const resetTokenFor = (email) => outboxTokenFor(email, "password_reset", /#\/restablecer\/([\w.-]+)/);

/** Último enlace para confirmar un correo nuevo (Mi perfil → cambiar correo). */
export const emailChangeTokenFor = (email) =>
  outboxTokenFor(email, "email_change_verification", /#\/confirmar-correo\/([\w.-]+)/);

/** Cuántos correos de esa plantilla recibió ese correo. */
export async function outboxCount(email, template) {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    const { rows } = await db.query(
      "SELECT count(*)::int AS n FROM email_outbox WHERE to_address = $1 AND template = $2",
      [email, template]
    );
    return rows[0].n;
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
  const email = await inviteByApi({ name, role });
  const api = await request.newContext({ baseURL: API });
  try {
    const accepted = await api.post("/api/auth/invitations/accept", {
      data: { token: await invitationTokenFor(email), password: NEW_ACCOUNT_PASSWORD },
    });
    expect(accepted.status(), "activación").toBe(200);
    return { email, password: NEW_ACCOUNT_PASSWORD, accessToken: (await accepted.json()).accessToken };
  } finally {
    await api.dispose();
  }
}

/**
 * Admin nuevo con la verificación en dos pasos ya activa (por la API).
 * Devuelve su secreto TOTP y sus códigos de recuperación. Uno por prueba:
 * cada código de la app sirve una sola vez.
 */
export async function createAdminWithMfa({ name = "Admin E2E" } = {}) {
  const account = await createAccountByInvitation({ name, role: "admin" });
  const api = await request.newContext({ baseURL: API });
  try {
    const headers = { Authorization: `Bearer ${account.accessToken}` };
    const setup = await api.post("/api/users/me/mfa/setup", { headers, data: { password: account.password } });
    expect(setup.status(), "MFA setup").toBe(201);
    const { secret } = await setup.json();
    const enable = await api.post("/api/users/me/mfa/enable", { headers, data: { code: totpCode(secret) } });
    expect(enable.status(), "MFA enable").toBe(200);
    return { ...account, mfaSecret: secret, recoveryCodes: (await enable.json()).recoveryCodes };
  } finally {
    await api.dispose();
  }
}

/**
 * Inicia sesión por la interfaz. Con mfaSecret, completa el segundo paso con
 * el código del paso SIGUIENTE (+30 s: la API acepta ±1 paso y nunca repite
 * el que se usó al activar).
 */
export async function loginThroughUi(page, { email, password, mfaSecret }) {
  await page.goto("/#/login");
  const form = page.locator("#login-form");
  await form.getByLabel("Correo").fill(email);
  await form.getByLabel("Contraseña").fill(password);
  await form.getByRole("button", { name: "Entrar" }).click();
  if (mfaSecret) {
    await page.getByLabel("Código de la app").fill(totpCode(mfaSecret, 1));
    await page.getByRole("button", { name: "Verificar" }).click();
  }
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

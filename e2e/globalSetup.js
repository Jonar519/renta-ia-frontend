import fs from "node:fs";
import path from "node:path";
import { request } from "@playwright/test";
import pg from "pg";
import { API, DATABASE_URL, SEED_ADMIN, SEED_ADMIN_FILE } from "./config.js";
import { totpCode } from "./totp.js";

/**
 * Antes de las pruebas: el admin del seed activa su verificación en dos pasos
 * (obligatoria para admin desde B9), como lo haría en su primer login.
 *
 * Solo en la base E2E: se borra su MFA anterior (de una corrida previa, con un
 * secreto que ya no se conoce) y se vuelve a activar por la API real. Su
 * sesión (15 min, más que la corrida) la usan los helpers para invitar cuentas
 * por la API; así no hace falta un login con código por prueba (cada código
 * sirve una sola vez y las pruebas corren en paralelo).
 */
export default async function globalSetup() {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    await db.query("DELETE FROM user_mfa WHERE user_id = (SELECT id FROM users WHERE email = $1)", [SEED_ADMIN.email]);
  } finally {
    await db.end();
  }

  const api = await request.newContext({ baseURL: API });
  try {
    const login = await api.post("/api/auth/login", { data: SEED_ADMIN });
    if (login.status() !== 200) throw new Error(`login del admin del seed: ${login.status()}`);
    const { accessToken } = await login.json();
    const headers = { Authorization: `Bearer ${accessToken}` };
    const setup = await api.post("/api/users/me/mfa/setup", { headers, data: { password: SEED_ADMIN.password } });
    if (setup.status() !== 201)
      throw new Error(`MFA del admin del seed (setup): ${setup.status()} ${await setup.text()}`);
    const { secret } = await setup.json();
    const enable = await api.post("/api/users/me/mfa/enable", { headers, data: { code: totpCode(secret) } });
    if (enable.status() !== 200) throw new Error(`MFA del admin del seed (enable): ${enable.status()}`);
    fs.mkdirSync(path.dirname(SEED_ADMIN_FILE), { recursive: true });
    fs.writeFileSync(SEED_ADMIN_FILE, JSON.stringify({ accessToken, secret }));
  } finally {
    await api.dispose();
  }
}

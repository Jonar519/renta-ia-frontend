import fs from "node:fs";
import pg from "pg";
import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { API, DATABASE_URL, SEED_ADMIN_FILE } from "./config.js";
import { createAccountByInvitation, invitationTokenFor, loginThroughUi, NEW_ACCOUNT_PASSWORD } from "./helpers.js";

/**
 * Revisión de conceptos (B16) en Chrome:
 *  - el badge "Extraído por IA · sin revisar" desaparece para siempre al
 *    revisar (también al recargar);
 *  - el usuario del portal ve solo "Revisado" (la API no le manda quién ni lo
 *    que leyó la IA);
 *  - reprocesar un documento revisado pide confirmación (D6) y "Volver" no
 *    borra nada; confirmar queda auditado.
 */

const sql = async (query, params = []) => {
  const db = new pg.Client({ connectionString: DATABASE_URL });
  await db.connect();
  try {
    return (await db.query(query, params)).rows;
  } finally {
    await db.end();
  }
};

/** Contador con un cliente, un documento terminado con advertencias y un concepto de la IA sin revisar. */
async function accountantWithConcept(request) {
  const account = await createAccountByInvitation({ name: "Revisa E2E" });
  const stamp = Date.now();
  const res = await request.post(`${API}/api/clients`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    data: { fullName: `Cliente Revisión ${stamp}`, documentNumber: `E2E-${stamp}` },
  });
  const client = await res.json();
  const [doc] = await sql(
    `INSERT INTO documents (client_id, uploaded_by, doc_type, original_name, storage_key, status, error_message)
     SELECT $1::uuid, u.id, 'income_certificate', 'certificado-2025.pdf', 'clients/' || $1::text || '/documents/e2e.pdf', 'processed', 'Advertencia de prueba'
     FROM users u WHERE u.email = $2 RETURNING id`,
    [client.id, account.email]
  );
  const [concept] = await sql(
    `INSERT INTO tax_concepts (document_id, client_id, concept_type, description, amount, period_year)
     VALUES ($1, $2, 'withholding', 'Retención en la fuente', 1500000, 2025) RETURNING id`,
    [doc.id, client.id]
  );
  return { account, client, docId: doc.id, conceptId: concept.id };
}

async function openDocuments(page, clientId) {
  await page.goto(`/#/clients/${clientId}`);
  await page.getByRole("tab", { name: "Documentos" }).click();
  await expect(page.locator("#concepts-table tbody tr[data-concept-id]").first()).toBeVisible();
}

test("revisar: el badge de IA desaparece para siempre (también al recargar); el portal ve solo 'Revisado'", async ({
  page,
  browser,
  request,
}, testInfo) => {
  const { account, client, conceptId } = await accountantWithConcept(request);
  await loginThroughUi(page, account);
  await openDocuments(page, client.id);

  const row = page.locator(`tr[data-concept-id="${conceptId}"]`);
  await expect(row.getByText("Extraído por IA · sin revisar")).toBeVisible();
  await expect(page.locator("#concepts-totals")).toContainText("Incluye 1 concepto extraído por IA sin revisar.");
  await expectNoSeriousA11yViolations(page, testInfo, "concepto-sin-revisar");

  await row.getByRole("button", { name: /Revisar/ }).click();
  const amount = row.getByLabel("Monto revisado (COP)");
  await expect(amount).toBeFocused();
  await expect(row).toContainText("La IA leyó");
  await expectNoSeriousA11yViolations(page, testInfo, "concepto-revisando");
  await amount.fill("1.450.000,50");
  await row.getByRole("button", { name: "Confirmar" }).click();

  await expect(row.getByText("Revisado", { exact: true })).toBeVisible();
  await expect(row.getByText("Extraído por IA · sin revisar")).toHaveCount(0);
  await expect(row).toContainText("por Revisa E2E");
  await expect(row).toContainText("Corregido · la IA leyó");
  await expect(page.locator("#concepts-totals")).not.toContainText("sin revisar");

  // Para siempre: al recargar sigue revisado (lo guardó la API).
  await page.reload();
  await openDocuments(page, client.id);
  await expect(page.locator(`tr[data-concept-id="${conceptId}"]`).getByText("Revisado", { exact: true })).toBeVisible();
  await expect(page.getByText("Extraído por IA · sin revisar")).toHaveCount(0);
  await expectNoSeriousA11yViolations(page, testInfo, "concepto-revisado");

  // El portal del contribuyente: solo "Revisado", sin quién ni lo que leyó la IA.
  const seedAdmin = JSON.parse(fs.readFileSync(SEED_ADMIN_FILE, "utf8"));
  const email = `portal-${Date.now()}@test.local`;
  const invited = await request.post(`${API}/api/admin/invitations`, {
    headers: { Authorization: `Bearer ${seedAdmin.accessToken}` },
    data: { name: "Portal E2E", email, role: "client", clientId: client.id },
  });
  expect(invited.status()).toBe(201);
  await request.post(`${API}/api/auth/invitations/accept`, {
    data: { token: await invitationTokenFor(email), password: NEW_ACCOUNT_PASSWORD },
  });
  const portal = await (await browser.newContext()).newPage();
  await portal.goto("/#/login");
  const form = portal.locator("#login-form");
  await form.getByLabel("Correo").fill(email);
  await form.getByLabel("Contraseña").fill(NEW_ACCOUNT_PASSWORD);
  await form.getByRole("button", { name: "Entrar" }).click();
  await expect(portal.locator("#login-form")).toHaveCount(0);
  const conceptsResponse = portal.waitForResponse((r) => r.url().includes("/tax-concepts"));
  await portal.goto(`/#/clients/${client.id}`);
  const body = await (await conceptsResponse).json();
  expect(Object.keys(body[0]).sort()).toEqual(["amount", "conceptType", "description", "id", "periodYear", "reviewed"]);
  const portalRow = portal.locator(`tr[data-concept-id="${conceptId}"]`);
  await expect(portalRow.getByText("Revisado", { exact: true })).toBeVisible();
  await expect(portalRow).not.toContainText("Revisa E2E");
  await expect(portalRow).not.toContainText("la IA leyó");
  await expect(portalRow.getByRole("button")).toHaveCount(0);
});

test("reprocesar un documento revisado pide confirmación; 'Volver' no borra nada y confirmar queda auditado", async ({
  page,
  request,
}, testInfo) => {
  const { account, client, docId, conceptId } = await accountantWithConcept(request);
  const review = await request.patch(`${API}/api/clients/${client.id}/tax-concepts/${conceptId}`, {
    headers: { Authorization: `Bearer ${account.accessToken}` },
    data: { amount: 1400000 },
  });
  expect(review.status()).toBe(200);
  await loginThroughUi(page, account);
  await openDocuments(page, client.id);

  const retry = page.getByRole("button", { name: /Reintentar análisis/ });
  await retry.click();
  const dialog = page.getByRole("dialog", { name: "¿Descartar las revisiones?" });
  await expect(dialog).toContainText("1 concepto revisado");
  await expectNoSeriousA11yViolations(page, testInfo, "descartar-revisiones");
  await dialog.getByRole("button", { name: "Volver" }).click();
  await expect(retry).toBeFocused();
  // Nada cambió: el concepto sigue revisado y el documento, igual.
  const [kept] = await sql(`SELECT reviewed_at, amount FROM tax_concepts WHERE id = $1`, [conceptId]);
  expect(kept.reviewed_at).not.toBeNull();
  expect(Number(kept.amount)).toBe(1400000);
  expect((await sql(`SELECT status FROM documents WHERE id = $1`, [docId]))[0].status).toBe("processed");

  await retry.click();
  await dialog.getByRole("button", { name: "Descartar revisiones y reprocesar" }).click();
  await expect(page.locator(".toast", { hasText: "Análisis reencolado" })).toBeVisible();
  const audited = await sql(
    `SELECT count(*)::int AS n FROM audit_log WHERE action = 'document.reprocess.discard_reviews' AND entity_id = $1`,
    [docId]
  );
  expect(audited[0].n).toBe(1);
});

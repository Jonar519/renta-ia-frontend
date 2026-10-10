import pg from "pg";
import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { DATABASE_URL } from "./config.js";
import { accountantWithFiles } from "./documentFiles.js";
import { loginThroughUi } from "./helpers.js";

/**
 * Vista dividida (B18, versión simplificada) en Chrome:
 *  - con el original abierto, el visor y la tabla de Conceptos que ya existe
 *    quedan lado a lado en pantallas anchas, y la tabla muestra solo los
 *    conceptos de ese documento;
 *  - se revisa con el formulario y el endpoint de B16 (PATCH
 *    /api/clients/:id/tax-concepts/:conceptId), y al cerrar la tabla principal
 *    ya está sincronizada;
 *  - el orden del teclado es visor → conceptos; el foco vuelve al cerrar;
 *  - en móvil (375 y 320 px) se apilan, sin desplazamiento horizontal.
 * El portal y el admin no tienen visor (e2e/documentViewer.spec.js), así que
 * nunca ven la vista dividida.
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
const pageOverflow = (page) =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const clippedCells = (page) =>
  page.evaluate(() =>
    [...document.querySelectorAll(".table--stack td")]
      .filter((td) => td.scrollWidth > td.clientWidth + 1)
      .map((td) => `${td.dataset.label}: ${td.textContent.trim().slice(0, 40)}`)
  );

/**
 * Contador con el PDF (la IA simulada extrae 3 conceptos) y la imagen, a la
 * que se le agrega un concepto: así el filtro por documento se nota.
 */
async function accountantWithConcepts(request) {
  const data = await accountantWithFiles(request);
  await expect
    .poll(
      async () =>
        (await sql(`SELECT count(*)::int AS n FROM tax_concepts WHERE document_id = $1`, [data.files.pdf]))[0].n,
      {
        timeout: 30_000,
      }
    )
    .toBe(3);
  const [imageConcept] = await sql(
    `INSERT INTO tax_concepts (document_id, client_id, concept_type, description, amount, period_year)
     VALUES ($1, $2, 'withholding', 'Retención del extracto', 75000, 2025) RETURNING id`,
    [data.files.image, data.client.id]
  );
  return { ...data, imageConceptId: imageConcept.id };
}

async function openDocuments(page, clientId) {
  await page.goto(`/#/clients/${clientId}`);
  await page.getByRole("tab", { name: "Documentos" }).click();
  await expect(page.locator("#concepts-table tr[data-concept-id]")).toHaveCount(4);
}

const viewerBox = (page) => page.locator("#document-viewer .viewer").boundingBox();
const conceptsBox = (page) => page.locator(".split > .panel").boundingBox();

test("lado a lado: solo los conceptos del documento; se revisan con el endpoint de B16 y la tabla se sincroniza", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  const { account, client, files, imageConceptId } = await accountantWithConcepts(page.request);
  await loginThroughUi(page, account);
  await openDocuments(page, client.id);

  const viewButton = page.locator(`button[data-view-id="${files.pdf}"]`);
  await viewButton.click();
  const viewer = page.locator("#document-viewer .viewer");
  await expect(viewer.getByRole("heading", { name: "certificado-2025.pdf" })).toBeFocused();
  await expect(viewer.locator("canvas")).toBeVisible();

  // Lado a lado: el visor a la izquierda, los conceptos a la derecha, en la misma franja
  // (el visor es sticky: queda fijo mientras la columna de conceptos se desplaza).
  const v = await viewerBox(page);
  const c = await conceptsBox(page);
  expect(v.x + v.width).toBeLessThanOrEqual(c.x);
  expect(v.y).toBeLessThan(c.y + c.height);
  expect(c.y).toBeLessThan(v.y + v.height);
  expect(await pageOverflow(page)).toBe(0);
  // Media columna: los conceptos van en tarjetas, sin celdas cortadas.
  await expect(page.locator("#concepts-table thead")).toHaveCSS("position", "absolute");
  expect(await clippedCells(page)).toEqual([]);

  // Solo los conceptos del PDF; el de la imagen no.
  const rows = page.locator("#concepts-table tr[data-concept-id]");
  await expect(rows).toHaveCount(3);
  await expect(page.locator(`tr[data-concept-id="${imageConceptId}"]`)).toHaveCount(0);
  await expect(page.locator("#concepts-filter")).toContainText("Conceptos de certificado-2025.pdf: 3 de 4.");
  await expectNoSeriousA11yViolations(page, testInfo, "vista-dividida");

  // Teclado: desde el visor, el orden pasa por sus controles y luego por los conceptos (nunca al revés).
  const zones = [];
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press("Tab");
    zones.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        if (el.closest("#document-viewer")) return "visor";
        if (el.closest(".split > .panel")) return el.matches("button[data-review-id]") ? "revisar" : "conceptos";
        return "otro";
      })
    );
  }
  const firstConcepts = zones.findIndex((z) => z !== "visor");
  expect(firstConcepts).toBeGreaterThan(0);
  expect(zones.slice(firstConcepts).every((z) => z !== "visor")).toBe(true);
  expect(zones).toContain("revisar");

  // Revisar en la vista dividida: el formulario de B16 y SU endpoint (un solo PATCH).
  const mutations = [];
  page.on("request", (r) => {
    if (r.method() !== "GET" && r.url().includes("/api/")) mutations.push(`${r.method()} ${new URL(r.url()).pathname}`);
  });
  const first = rows.first();
  const conceptId = await first.getAttribute("data-concept-id");
  await first.getByRole("button", { name: /Revisar/ }).click();
  const amount = first.getByLabel("Monto revisado (COP)");
  await expect(amount).toBeFocused();
  await expectNoSeriousA11yViolations(page, testInfo, "vista-dividida-revisando");
  await amount.fill("123.456");
  await amount.press("Enter");
  const reviewed = page.locator(`tr[data-concept-id="${conceptId}"]`);
  await expect(reviewed.getByText("Revisado", { exact: true })).toBeVisible();
  expect(mutations).toEqual([`PATCH /api/clients/${client.id}/tax-concepts/${conceptId}`]);
  expect(Number((await sql(`SELECT amount FROM tax_concepts WHERE id = $1`, [conceptId]))[0].amount)).toBe(123456);

  // Al cerrar (Escape desde el visor): vuelven todos, con la revisión ya aplicada, y el foco al botón.
  await viewer.getByRole("button", { name: "Cerrar" }).focus();
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(viewButton).toBeFocused();
  await expect(rows).toHaveCount(4);
  await expect(page.locator("#concepts-filter")).toBeHidden();
  await expect(reviewed).toContainText("$123.456");
  await expect(reviewed.getByText("Revisado", { exact: true })).toBeVisible();
  await expect(page.locator("#concepts-table thead")).not.toHaveCSS("position", "absolute");
});

for (const width of [375, 320]) {
  test(`móvil (${width} px): el visor y los conceptos se apilan, sin desplazamiento horizontal`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 800 });
    const { account, client, files } = await accountantWithConcepts(page.request);
    await loginThroughUi(page, account);
    await openDocuments(page, client.id);
    await page.locator(`button[data-view-id="${files.pdf}"]`).click();
    await expect(page.locator("#document-viewer canvas")).toBeVisible();
    await expect(page.locator("#concepts-table tr[data-concept-id]")).toHaveCount(3);

    const v = await viewerBox(page);
    const c = await conceptsBox(page);
    expect(v.y + v.height).toBeLessThanOrEqual(c.y);
    expect(v.width).toBeLessThanOrEqual(width);
    expect(await pageOverflow(page)).toBe(0);
    expect(await clippedCells(page)).toEqual([]);
    await expectNoSeriousA11yViolations(page, testInfo, `vista-dividida-${width}`);
  });
}

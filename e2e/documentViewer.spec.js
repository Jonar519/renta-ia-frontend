import fs from "node:fs";
import path from "node:path";
import { expect, test } from "./fixtures.js";
import { expectNoSeriousA11yViolations } from "./a11y.js";
import { API, SEED_ADMIN_FILE } from "./config.js";
import { accountantWithFiles } from "./documentFiles.js";
import { createAdminWithMfa, invitationTokenFor, loginThroughUi, NEW_ACCOUNT_PASSWORD } from "./helpers.js";

/**
 * Vista dividida I (B17) en Chrome, con la CSP real del build:
 *  - contador y asistente abren el original en el visor; pdf.js NO se
 *    descarga al abrir Documentos ni al abrir una imagen, solo al abrir un
 *    PDF, y la biblioteca y su worker salen del mismo origen;
 *  - un PDF dañado muestra su estado propio;
 *  - el portal y el admin ven "Descargar" y no el visor (ni lo descargan).
 * Las violaciones de CSP hacen fallar cualquier prueba (fixtures.js).
 */

const PDFJS_REQUEST = /\/assets\/pdf(\.worker)?\.min-[\w-]+\.m?js$/;
const VIEWER_CHUNK = /\/assets\/documentViewer-[\w-]+\.js$/;

/**
 * Peticiones de pdf.js y del visor que hace la app (página y su worker de
 * pdf.js). No se cuentan las del Service Worker: precachea los chunks de la
 * app (no pdf.js, ver vite.config.js), pero eso no es abrir el visor.
 */
function watchRequests(context) {
  const seen = { pdfjs: [], viewer: [] };
  context.on("request", (req) => {
    if (req.serviceWorker()) return;
    if (PDFJS_REQUEST.test(req.url())) seen.pdfjs.push(req.url());
    if (VIEWER_CHUNK.test(req.url())) seen.viewer.push(req.url());
  });
  return seen;
}

async function openDocuments(page, clientId) {
  await page.goto(`/#/clients/${clientId}`);
  await page.getByRole("tab", { name: "Documentos" }).click();
  await expect(page.locator("tr[data-document-id]")).toHaveCount(3);
}

test("contador: imagen y PDF en el visor; pdf.js solo al abrir un PDF, del mismo origen; PDF dañado con su estado", async ({
  page,
  context,
  request,
}, testInfo) => {
  const { account, client, files } = await accountantWithFiles(request);
  const seen = watchRequests(context);
  await loginThroughUi(page, account);
  await openDocuments(page, client.id);

  // Abrir la pantalla de Documentos no descarga el visor ni pdf.js.
  await page.waitForLoadState("networkidle");
  expect(seen.viewer).toEqual([]);
  expect(seen.pdfjs).toEqual([]);
  await expect(page.getByRole("button", { name: /^Descargar/ })).toHaveCount(0);

  // Imagen: <img>, sin pdf.js.
  const viewImage = page.locator(`button[data-view-id="${files.image}"]`);
  await viewImage.click();
  const viewer = page.locator("#document-viewer .viewer");
  await expect(viewer.getByRole("heading", { name: "extracto-escaneado.png" })).toBeFocused();
  await expect(viewer.getByRole("img", { name: "Documento original: extracto-escaneado.png" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Descargar" })).toBeVisible();
  expect(seen.viewer).toHaveLength(1);
  await page.waitForLoadState("networkidle");
  expect(seen.pdfjs).toEqual([]);
  await expectNoSeriousA11yViolations(page, testInfo, "visor-imagen");
  await page.keyboard.press("Escape");
  await expect(viewer).toHaveCount(0);
  await expect(viewImage).toBeFocused();

  // PDF: ahora sí pdf.js, la biblioteca y su worker, ambos del mismo origen.
  await page.locator(`button[data-view-id="${files.pdf}"]`).click();
  const canvas = viewer.getByRole("img", { name: "Página 1 de 1 de certificado-2025.pdf" });
  await expect(canvas).toBeVisible();
  await expect(viewer.locator("[data-page]")).toHaveText("1 / 1");
  await expect(viewer.getByRole("button", { name: "Página anterior" })).toBeDisabled();
  // Los dos módulos ?url (con la URL de cada archivo), la biblioteca y su worker.
  const kinds = () => seen.pdfjs.map((u) => path.basename(new URL(u).pathname).replace(/-[\w-]+\./, ".")).sort();
  await expect.poll(kinds).toEqual(["pdf.min.js", "pdf.min.mjs", "pdf.worker.min.js", "pdf.worker.min.mjs"]);
  const origin = new URL(page.url()).origin;
  for (const url of seen.pdfjs) expect(new URL(url).origin).toBe(origin);
  const width = await canvas.evaluate((c) => c.width);
  await viewer.getByRole("button", { name: "Acercar" }).click();
  await expect.poll(() => canvas.evaluate((c) => c.width)).toBeGreaterThan(width);
  await expectNoSeriousA11yViolations(page, testInfo, "visor-pdf");
  await testInfo.attach("visor-pdf.png", { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  await viewer.getByRole("button", { name: "Cerrar" }).click();
  await expect(viewer).toHaveCount(0);

  // PDF dañado: estado propio, con Reintentar y la descarga disponible.
  await page.locator(`button[data-view-id="${files.damaged}"]`).click();
  await expect(viewer).toContainText("El PDF está dañado o no se puede leer. Descárgalo para revisarlo.");
  await expect(viewer.getByRole("button", { name: "Reintentar" })).toBeVisible();
  await expect(viewer.getByRole("link", { name: "Descargar" })).toBeVisible();
  await expectNoSeriousA11yViolations(page, testInfo, "visor-pdf-danado");
});

for (const who of ["portal", "admin"]) {
  test(`${who}: ve «Descargar» y no el visor (ni descarga su código ni pdf.js)`, async ({ page, context, request }) => {
    const { client } = await accountantWithFiles(request);
    let account;
    if (who === "admin") {
      account = await createAdminWithMfa({ name: "Admin Visor" });
    } else {
      const email = `portal-visor-${Date.now()}@test.local`;
      const seedAdmin = JSON.parse(fs.readFileSync(SEED_ADMIN_FILE, "utf8"));
      const invited = await request.post(`${API}/api/admin/invitations`, {
        headers: { Authorization: `Bearer ${seedAdmin.accessToken}` },
        data: { name: "Portal Visor", email, role: "client", clientId: client.id },
      });
      expect(invited.status()).toBe(201);
      await request.post(`${API}/api/auth/invitations/accept`, {
        data: { token: await invitationTokenFor(email), password: NEW_ACCOUNT_PASSWORD },
      });
      account = { email, password: NEW_ACCOUNT_PASSWORD };
    }
    const seen = watchRequests(context);
    if (who === "admin") {
      await loginThroughUi(page, account);
    } else {
      // El portal llega a su expediente, no a "Tus clientes".
      await page.goto("/#/login");
      const form = page.locator("#login-form");
      await form.getByLabel("Correo").fill(account.email);
      await form.getByLabel("Contraseña").fill(account.password);
      await form.getByRole("button", { name: "Entrar" }).click();
      await expect(page.locator("#login-form")).toHaveCount(0);
    }
    await openDocuments(page, client.id);

    await expect(page.locator("button[data-view-id]")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Ver original/ })).toHaveCount(0);
    const download = page.getByRole("button", { name: "Descargar certificado-2025.pdf" });
    await expect(download).toBeVisible();
    const [file] = await Promise.all([page.waitForEvent("download"), download.click()]);
    expect(file.suggestedFilename()).toBe("certificado-2025.pdf");
    expect(
      fs
        .readFileSync(await file.path())
        .subarray(0, 5)
        .toString()
    ).toBe("%PDF-");
    await expect(page.locator("#document-viewer")).toBeEmpty();
    await page.waitForLoadState("networkidle");
    expect(seen.viewer).toEqual([]);
    expect(seen.pdfjs).toEqual([]);
  });
}

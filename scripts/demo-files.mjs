/**
 * Originales de prueba para la guía de demo (DATOS SINTÉTICOS): un certificado
 * en PDF con texto (la IA simulada extrae sus tres conceptos) y una imagen PNG.
 * Son los mismos que usan las pruebas E2E.
 *
 * Uso (desde renta-ia-frontend): node scripts/demo-files.mjs [carpeta]
 * Por defecto los deja en la carpeta actual.
 */
import fs from "node:fs";
import path from "node:path";
import { certificatePdf } from "../e2e/pdf.js";
import { stripesPng } from "../e2e/documentFiles.js";

const dir = path.resolve(process.argv[2] ?? ".");
fs.mkdirSync(dir, { recursive: true });
const files = {
  "certificado-demo.pdf": certificatePdf(`demo-${Date.now()}`),
  "extracto-demo.png": stripesPng(),
};
for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(dir, name), content);
  console.log(path.join(dir, name));
}

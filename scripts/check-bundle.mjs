/**
 * Presupuesto de tamaño del bundle (gzip). Falla (exit 1) si se excede.
 * Se ejecuta después de "vite build" (npm run build) y en CI.
 *
 * Los límites tienen un margen sobre lo medido al fijarlos (ver
 * docs/performance-report.md): el objetivo no es "que pase", sino que un
 * aumento grande (una dependencia pesada, fuentes de más, perder el
 * code-splitting) se note en el PR.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const DIST = path.resolve("dist");
const KB = 1024;
const BUDGETS = {
  // JS que descarga cualquier visita antes de ver algo: el chunk de entrada.
  entryJsGzip: 4 * KB, // medido: 2,69 KB; Fase 5 (B6): 3,93 KB
  // Tope POR CHUNK (Fase 5, B6): ningún chunk supera 6 KB, salvo las
  // excepciones nombradas en CHUNK_EXCEPTIONS, cada una con su tope medido.
  // (Antes: "chunk más grande" ≤ 10 KB.)
  chunkGzip: 6 * KB,
  // Fase 5: B2 (estados explícitos) llevó el total a 30,08 KB y B6 (pantallas
  // de invitación: adminUsers 3,47 + completeAccount 2,17) a 38,66 KB. Esos
  // chunks solo los descarga quien entra a esas rutas (admin o persona
  // invitada); el total suma TODOS los chunks. 30 KB → 34 KB (B2) → 42 KB (B6).
  totalJsGzip: 42 * KB,
  // 4 → 5 KB en B2 (medido 4,19 KB).
  totalCssGzip: 5 * KB,
  // Fase 5: +JetBrains Mono 400 latín (20,67 KB) para las cifras. Medido:
  // 88,82 KB; antes 75 KB con 68,15 KB medidos (woff2 ya viene comprimido).
  fontsBytes: 95 * KB,
};

// Única excepción al tope por chunk: el detalle de cliente (sus cuatro
// pestañas: documentos con sus Web Workers, alertas, resumen y chat). Medido:
// 8,32 KB en B6 (7,24 KB al fijar el presupuesto original de 10 KB).
const CHUNK_EXCEPTIONS = { clientDetail: 9 * KB };

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const chunkName = (file) => path.basename(file).replace(/-[\w-]{8}\.js$/, "");
const assets = fs.readdirSync(path.join(DIST, "assets")).map((name) => path.join(DIST, "assets", name));
const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const entryName = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entryName) throw new Error("No se encontró el script de entrada en dist/index.html");

const js = assets.filter((f) => f.endsWith(".js"));
const entryFile = path.join(DIST, "assets", entryName);
const chunks = js
  .filter((f) => f !== entryFile)
  .map((f) => ({ name: chunkName(f), size: gzipSize(f), limit: CHUNK_EXCEPTIONS[chunkName(f)] ?? BUDGETS.chunkGzip }));
const biggestRegular = chunks.filter((c) => !CHUNK_EXCEPTIONS[c.name]).sort((a, b) => b.size - a.size)[0];

const measured = {
  entryJsGzip: gzipSize(entryFile),
  chunkGzip: biggestRegular?.size ?? 0,
  totalJsGzip: js.reduce((s, f) => s + gzipSize(f), 0),
  totalCssGzip: assets.filter((f) => f.endsWith(".css")).reduce((s, f) => s + gzipSize(f), 0),
  fontsBytes: assets.filter((f) => /\.(woff2?|ttf)$/.test(f)).reduce((s, f) => s + fs.statSync(f).size, 0),
};

let failed = false;
const line = (ok, label, value, limit, note = "") =>
  console.log(
    `  ${ok ? "OK   " : "EXCEDE"} ${label.padEnd(26)} ${(value / KB).toFixed(2).padStart(7)} KB / ${(limit / KB).toFixed(0)} KB${note}`
  );

console.log("Presupuesto de tamaño del bundle:");
for (const [key, limit] of Object.entries(BUDGETS)) {
  const value = measured[key];
  const ok = value <= limit;
  failed ||= !ok;
  line(ok, key === "chunkGzip" ? `chunk más grande (${biggestRegular?.name})` : key, value, limit);
}
for (const chunk of chunks) {
  const exception = Boolean(CHUNK_EXCEPTIONS[chunk.name]);
  const ok = chunk.size <= chunk.limit;
  failed ||= !ok;
  // Se listan las excepciones (siempre) y cualquier chunk que exceda su tope.
  if (exception || !ok)
    line(ok, `chunk ${chunk.name}`, chunk.size, chunk.limit, exception ? " (excepción documentada)" : "");
}
if (/fonts\.googleapis|fonts\.gstatic/.test(html)) {
  console.log("  EXCEDE index.html vuelve a cargar fuentes de Google (se autoalojan: src/styles/fonts.css)");
  failed = true;
}
process.exit(failed ? 1 : 0);

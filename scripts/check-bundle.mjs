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
  entryJsGzip: 4 * KB, // medido: 2,69 KB
  // Ningún chunk de vista debería superar esto.
  largestChunkGzip: 10 * KB, // medido: 7,24 KB (detalle de cliente)
  totalJsGzip: 30 * KB, // medido: 22,88 KB sumando todos los chunks
  totalCssGzip: 4 * KB, // medido: 2,99 KB
  fontsBytes: 75 * KB, // medido: 68,15 KB (woff2 ya viene comprimido)
};

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const assets = fs.readdirSync(path.join(DIST, "assets")).map((name) => path.join(DIST, "assets", name));
const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const entryName = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entryName) throw new Error("No se encontró el script de entrada en dist/index.html");

const js = assets.filter((f) => f.endsWith(".js"));
const measured = {
  entryJsGzip: gzipSize(path.join(DIST, "assets", entryName)),
  largestChunkGzip: Math.max(...js.map(gzipSize)),
  totalJsGzip: js.reduce((s, f) => s + gzipSize(f), 0),
  totalCssGzip: assets.filter((f) => f.endsWith(".css")).reduce((s, f) => s + gzipSize(f), 0),
  fontsBytes: assets.filter((f) => /\.(woff2?|ttf)$/.test(f)).reduce((s, f) => s + fs.statSync(f).size, 0),
};

let failed = false;
console.log("Presupuesto de tamaño del bundle:");
for (const [key, limit] of Object.entries(BUDGETS)) {
  const value = measured[key];
  const ok = value <= limit;
  failed ||= !ok;
  console.log(
    `  ${ok ? "OK   " : "EXCEDE"} ${key.padEnd(18)} ${(value / KB).toFixed(2).padStart(7)} KB / ${(limit / KB).toFixed(0)} KB`
  );
}
if (/fonts\.googleapis|fonts\.gstatic/.test(html)) {
  console.log("  EXCEDE index.html vuelve a cargar fuentes de Google (se autoalojan: src/styles/fonts.css)");
  failed = true;
}
process.exit(failed ? 1 : 0);

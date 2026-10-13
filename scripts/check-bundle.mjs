/**
 * Presupuesto de tamaño del bundle (gzip). Falla (exit 1) si se excede.
 * Se ejecuta después de "vite build" (npm run build) y en CI.
 *
 * Los límites tienen un margen sobre lo medido al fijarlos (ver
 * docs/performance-report.md): el objetivo no es "que pase", sino que un
 * aumento grande (una dependencia pesada, fuentes de más, perder el
 * code-splitting) se note en el PR.
 *
 * JS POR ROL (Fase 5, aprobado antes de B10; reemplaza al tope de JS total):
 * cuánto puede llegar a descargar cada rol, sumando el chunk de entrada, cada
 * pantalla a la que tiene acceso (con todo lo que importa, estático o
 * diferido), lo que se carga tras el load y sus Web Workers. Es el peor caso:
 * el rol abre todas sus pantallas. Las rutas y su acceso se leen de la tabla
 * de rutas de src/main.js (la misma que usa la app); el grafo de módulos, del
 * manifest de Vite. Un chunk que ningún rol alcanza hace fallar el chequeo
 * (salvo pdf.js, la excepción D3 con su propio tope: ver PDFJS).
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { PDFJS_ASSET } from "../vite.config.js";

const DIST = path.resolve("dist");
const KB = 1024;
const BUDGETS = {
  // JS que descarga cualquier visita antes de ver algo: el chunk de entrada.
  entryJsGzip: 4 * KB, // medido: 2,69 KB; Fase 5 (B6): 3,93 KB; (B9): 3,84 KB
  // Tope POR CHUNK (Fase 5, B6): ningún chunk supera 6 KB, salvo las
  // excepciones nombradas en CHUNK_EXCEPTIONS, cada una con su tope medido.
  chunkGzip: 6 * KB,
  // 4 → 5 KB en B2 (medido 4,19 KB) → 5,5 KB en B10 (aprobado: el login con
  // el flujo de ejemplo; medido 5,15 KB) → 7 KB para B15-B18 (confirmado por
  // escrito tras B14; medido 5,43 KB; estimado hasta B18: 6,43 KB).
  totalCssGzip: 7 * KB,
  // Fase 5: +JetBrains Mono 400 latín (20,67 KB) para las cifras. Medido:
  // 88,82 KB; antes 75 KB con 68,15 KB medidos (woff2 ya viene comprimido).
  fontsBytes: 95 * KB,
};

// Tope de JS por rol (aprobado; medido en B9: invitado 21,70 · contador y
// asistente 40,34 · cliente del portal 39,72 · admin 45,91 KB). Historia del
// tope total que reemplaza: 30 → 34 (B2) → 42 (B6) → 46 KB (B9).
// B12: +2 KB a los roles con sesión por la foto de perfil (aplicada sin
// aprobación escrita; el usuario decidió conservarla tras B12)
// (recortador 1,30 + descarga con sesión 0,55 + perfil 0,64 + menú 0,32 KB);
// medido: contador y asistente 46,36, cliente del portal 45,75, admin 51,98 KB.
// B13-B18 (confirmado por escrito por el usuario antes de B14): peor caso
// estimado por bloque + ~2 KB de margen. Medido tras B13: invitado 23,35 ·
// contador y asistente 47,79 · cliente del portal 47,18 · admin 53,40 KB.
// Estimación hasta B18: 23,35 · 55,2 · 55,2 · 53,1 · 60,8 KB.
const ROLE_BUDGETS = {
  invitado: 24 * KB,
  contador: 57 * KB,
  asistente: 57 * KB,
  "cliente del portal": 55 * KB,
  admin: 63 * KB,
};

// PRIMERA CARGA (aprobado antes de B13; estricto, como el peor caso por
// rol): lo que se descarga al abrir la app en la pantalla de llegada, sin
// tocar nada más: entrada + sus imports + la pantalla + lo que main.js carga
// tras el load (con sesión, también el tiempo real). Medido en B12: invitado
// 17,79 KB (login), con sesión 20,75 KB (Clientes).
const FIRST_LOAD_BUDGETS = {
  invitado: { route: "/login", session: false, limit: 19 * KB },
  // 22 → 23 KB en B15 (decisión escrita del usuario): el selector de densidad
  // en Clientes (pantalla de llegada) mide 22,39 KB.
  "con sesión": { route: "/", session: true, limit: 23 * KB },
};

// Excepciones al tope por chunk (cada una con su tope medido). Desde B16 no
// hay ninguna: el detalle de cliente (que tuvo 9 KB) se partió y la pestaña
// Documentos va en su propio chunk (decisión escrita del usuario).
const CHUNK_EXCEPTIONS = {};

// pdf.js (B17, excepción D3, decisión escrita del usuario): fuera de los topes
// por rol, con su propio tope (medido: 496 KB, la biblioteca y su worker). Se
// acepta solo si se descarga ÚNICAMENTE al abrir un PDF: lo importa de forma
// diferida el visor (que a su vez se descarga al pulsar "Ver original"), como
// archivos de Mozilla tal cual (?url, mismo origen), y nunca se precachea. La
// versión del paquete va fija en package.json para que el tope no se mueva.
const PDFJS = {
  limit: 520 * KB,
  loader: "src/views/clientDetail/documentViewer.js",
  keys: ["node_modules/pdfjs-dist/build/pdf.min.mjs?url", "node_modules/pdfjs-dist/build/pdf.worker.min.mjs?url"],
};
const isPdfjsKey = (key) => key.includes("node_modules/pdfjs-dist/");

// Módulos diferidos que un rol NUNCA descarga aunque esté en una pantalla
// suya: la pantalla los importa solo si el permiso lo deja (src/auth/permissions.js,
// que se verifica abajo). B17 (decisiones escritas del usuario): el portal y el
// admin no tienen visor del original, solo "Descargar".
const VIEWER = "src/views/clientDetail/documentViewer.js";
const ROLE_EXCLUDED = {
  "cliente del portal": { [VIEWER]: { permission: "document.viewer", role: "client" } },
  admin: { [VIEWER]: { permission: "document.viewer", role: "admin" } },
};

// Web Workers (no aparecen en el grafo del manifest): quién los usa.
const WORKERS = {
  // Subir documentos (SHA-256 del archivo): roles que pueden subir.
  "upload.worker": ["contador", "asistente", "admin"],
  // Totales de conceptos: todos los que ven el detalle de un cliente.
  "concepts.worker": ["contador", "asistente", "cliente del portal", "admin"],
};
// Tras el load, solo con sesión iniciada (main.js).
const SESSION_ONLY = new Set(["src/realtime/realtime.js"]);

const gzipSize = (file) => zlib.gzipSync(fs.readFileSync(file), { level: 9 }).length;
const chunkName = (file) => path.basename(file).replace(/-[\w-]{8}\.js$/, "");
const assets = fs.readdirSync(path.join(DIST, "assets")).map((name) => path.join(DIST, "assets", name));
const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const entryName = html.match(/<script type="module"[^>]*src="\/assets\/([^"]+\.js)"/)?.[1];
if (!entryName) throw new Error("No se encontró el script de entrada en dist/index.html");

const isPdfjsFile = (f) => PDFJS_ASSET.test(path.basename(f));
const js = assets.filter((f) => f.endsWith(".js") && !isPdfjsFile(f));
const pdfjsFiles = assets.filter(isPdfjsFile);
const entryFile = path.join(DIST, "assets", entryName);
const chunks = js
  .filter((f) => f !== entryFile)
  .map((f) => ({ name: chunkName(f), size: gzipSize(f), limit: CHUNK_EXCEPTIONS[chunkName(f)] ?? BUDGETS.chunkGzip }));
const biggestRegular = chunks.filter((c) => !CHUNK_EXCEPTIONS[c.name]).sort((a, b) => b.size - a.size)[0];

// ---------- JS por rol ----------
const MANIFEST = path.join(DIST, ".vite", "manifest.json");
if (!fs.existsSync(MANIFEST)) {
  throw new Error("Falta dist/.vite/manifest.json: corre npm run build (el chequeo lo borra al terminar).");
}
const manifest = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));
const entryKey = Object.keys(manifest).find((k) => manifest[k].isEntry);

/**
 * Todo lo que puede llegar a descargarse al cargar `key`: imports estáticos y
 * diferidos. Los diferidos que son pantallas de la tabla de rutas o módulos
 * "tras el load" de main.js NO se siguen: cada rol los suma solo si le tocan.
 */
function reach(key, files, excluded = {}) {
  const item = manifest[key];
  if (!item) throw new Error(`El manifest no tiene ${key}`);
  if (files.has(item.file)) return;
  files.add(item.file);
  for (const dep of item.imports ?? []) reach(dep, files, excluded);
  for (const dep of item.dynamicImports ?? []) {
    if (!ADDED_PER_ROLE.has(dep) && !isPdfjsKey(dep) && !excluded[dep]) reach(dep, files, excluded);
  }
}

const mainSrc = fs.readFileSync(path.resolve("src/main.js"), "utf8");
const routes = [
  ...mainSrc.matchAll(/\[\s*"([^"]+)",\s*\(\)\s*=>\s*import\("\.\/([^"]+)"\),\s*(PUBLIC|\{[^}]*\})\s*\]/g),
].map(([, pattern, file, access]) => {
  let audience;
  if (access === "PUBLIC") audience = "public";
  else if (/roles:\s*ADMIN\b/.test(access)) audience = "admin";
  else if (/auth:\s*true/.test(access) && !/roles:/.test(access)) audience = "session";
  else throw new Error(`Ruta ${pattern}: acceso no reconocido por check-bundle (${access})`);
  return { pattern, key: `src/${file}`, audience };
});
if (routes.length === 0) throw new Error("No se encontró la tabla de rutas en src/main.js");
const routeKeys = new Set(routes.map((r) => r.key));
// Lo demás que main.js importa de forma diferida: se carga tras el load (o con la sesión).
const afterLoad = [...mainSrc.matchAll(/import\("\.\/([^"]+)"\)/g)]
  .map(([, file]) => `src/${file}`)
  .filter((key) => !routeKeys.has(key));
const ADDED_PER_ROLE = new Set([...routeKeys, ...afterLoad]);

const AUDIENCES = {
  invitado: ["public"],
  contador: ["public", "session"],
  asistente: ["public", "session"],
  "cliente del portal": ["public", "session"],
  admin: ["public", "session", "admin"],
};
const workerFile = (name) => js.find((f) => path.basename(f).startsWith(`${name}-`));

const roleFiles = {};
for (const [role, audiences] of Object.entries(AUDIENCES)) {
  const files = new Set();
  const excluded = ROLE_EXCLUDED[role] ?? {};
  reach(entryKey, files, excluded);
  for (const key of afterLoad) if (role !== "invitado" || !SESSION_ONLY.has(key)) reach(key, files, excluded);
  for (const route of routes) if (audiences.includes(route.audience)) reach(route.key, files, excluded);
  for (const [worker, roles] of Object.entries(WORKERS)) {
    const file = workerFile(worker);
    if (!file) throw new Error(`No se encontró el worker ${worker} en dist/assets`);
    if (roles.includes(role)) files.add(path.relative(DIST, file).replace(/\\/g, "/"));
  }
  roleFiles[role] = files;
}

// Una exclusión solo vale si el módulo es diferido (nunca estático desde una
// pantalla, la entrada o lo cargado tras el load) y el permiso que lo protege
// no incluye al rol.
const permissionsSrc = fs.readFileSync(path.resolve("src/auth/permissions.js"), "utf8");
const staticClosure = (key, seen = new Set()) => {
  if (seen.has(key)) return seen;
  seen.add(key);
  for (const dep of manifest[key]?.imports ?? []) staticClosure(dep, seen);
  return seen;
};
const exclusionErrors = [];
for (const [role, modules] of Object.entries(ROLE_EXCLUDED)) {
  for (const [key, { permission, role: appRole }] of Object.entries(modules)) {
    if (!manifest[key]) exclusionErrors.push(`${role}: el manifest no tiene ${key}`);
    for (const from of [entryKey, ...routes.map((r) => r.key), ...afterLoad]) {
      if (staticClosure(from).has(key)) exclusionErrors.push(`${role}: ${from} importa ${key} de forma estática`);
    }
    const rule = permissionsSrc.match(new RegExp(`"${permission.replace(".", "\\.")}":\\s*\\[([^\\]]*)\\]`))?.[1];
    if (rule === undefined) exclusionErrors.push(`${role}: permissions.js no define "${permission}"`);
    else if (rule.includes(`"${appRole}"`))
      exclusionErrors.push(`${role}: el permiso "${permission}" incluye "${appRole}"`);
  }
}

const firstLoadFiles = {};
for (const [label, { route: pattern, session }] of Object.entries(FIRST_LOAD_BUDGETS)) {
  const route = routes.find((r) => r.pattern === pattern);
  if (!route) throw new Error(`Primera carga (${label}): la ruta ${pattern} no está en src/main.js`);
  const files = new Set();
  reach(entryKey, files);
  for (const key of afterLoad) if (session || !SESSION_ONLY.has(key)) reach(key, files);
  reach(route.key, files);
  firstLoadFiles[label] = files;
}

const measured = {
  entryJsGzip: gzipSize(entryFile),
  chunkGzip: biggestRegular?.size ?? 0,
  totalCssGzip: assets.filter((f) => f.endsWith(".css")).reduce((s, f) => s + gzipSize(f), 0),
  fontsBytes: assets.filter((f) => /\.(woff2?|ttf)$/.test(f)).reduce((s, f) => s + fs.statSync(f).size, 0),
};

let failed = false;
const line = (ok, label, value, limit, note = "") =>
  console.log(
    `  ${ok ? "OK   " : "EXCEDE"} ${label.padEnd(26)} ${(value / KB).toFixed(2).padStart(7)} KB / ${+(limit / KB).toFixed(1)} KB${note}`
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

console.log("JS de la primera carga (pantalla de llegada):");
for (const [label, { route, limit }] of Object.entries(FIRST_LOAD_BUDGETS)) {
  const value = [...firstLoadFiles[label]].reduce((s, f) => s + gzipSize(path.join(DIST, f)), 0);
  const ok = value <= limit;
  failed ||= !ok;
  line(ok, `${label} (#${route})`, value, limit, ` (${firstLoadFiles[label].size} archivos)`);
}

console.log("JS por rol (peor caso: todas sus pantallas):");
for (const [role, limit] of Object.entries(ROLE_BUDGETS)) {
  const value = [...roleFiles[role]].reduce((s, f) => s + gzipSize(path.join(DIST, f)), 0);
  const ok = value <= limit;
  failed ||= !ok;
  line(ok, role, value, limit, ` (${roleFiles[role].size} archivos)`);
}
for (const message of exclusionErrors) {
  console.log(`  EXCEDE exclusión por rol: ${message}`);
  failed = true;
}
// Todo chunk debe contar para algún rol (pdf.js va aparte, abajo).
const counted = new Set(Object.values(roleFiles).flatMap((files) => [...files]));
for (const file of js) {
  const rel = path.relative(DIST, file).replace(/\\/g, "/");
  if (!counted.has(rel)) {
    console.log(`  EXCEDE ${rel} no lo descarga ningún rol según la tabla de rutas: asígnalo en check-bundle.mjs`);
    failed = true;
  }
}

console.log("pdf.js (excepción D3: solo al abrir un PDF):");
{
  const value = pdfjsFiles.reduce((s, f) => s + gzipSize(f), 0);
  const ok = value <= PDFJS.limit && pdfjsFiles.length > 0;
  failed ||= !ok;
  line(
    ok,
    "pdf.js (biblioteca+worker)",
    value,
    PDFJS.limit,
    ` (${pdfjsFiles.length} archivos, fuera de los topes por rol)`
  );
  const fail = (message) => {
    console.log(`  EXCEDE ${message}`);
    failed = true;
  };
  for (const [key, item] of Object.entries(manifest)) {
    // Empaquetado como módulo (import "pdfjs-dist"): Vite lo minificaría de
    // nuevo y quedaría dentro del grafo de alguna pantalla.
    if (isPdfjsKey(key) && !PDFJS.keys.includes(key) && item.file.endsWith(".js")) {
      fail(`${key} está empaquetado como módulo (${item.file}): pdf.js solo se carga con ?url desde ${PDFJS.loader}`);
    }
    for (const dep of item.imports ?? []) {
      if (isPdfjsKey(dep)) fail(`${key} importa pdf.js de forma estática (${dep})`);
    }
    for (const dep of item.dynamicImports ?? []) {
      if (isPdfjsKey(dep) && key !== PDFJS.loader)
        fail(`${key} importa pdf.js (${dep}): solo puede hacerlo ${PDFJS.loader}`);
    }
  }
  // El visor (que carga pdf.js) nunca va en el grafo estático de una pantalla,
  // de la entrada ni de lo que se carga tras el load.
  for (const key of [entryKey, ...routes.map((r) => r.key), ...afterLoad]) {
    if (staticClosure(key).has(PDFJS.loader)) fail(`${key} importa el visor (${PDFJS.loader}) de forma estática`);
  }
  for (const key of PDFJS.keys) if (!manifest[key]) fail(`el manifest no tiene ${key}`);
  // pdf.js incrustado en otro chunk (un import estático con un solo importador
  // no deja entrada propia en el manifest): su código lleva la versión como
  // texto ("6.4.299"), que el código propio nunca tiene.
  const installed = JSON.parse(fs.readFileSync(path.resolve("node_modules/pdfjs-dist/package.json"), "utf8")).version;
  for (const file of js) {
    if (fs.readFileSync(file, "utf8").includes(`"${installed}"`)) {
      fail(`${path.basename(file)} contiene código de pdf.js: solo puede descargarse aparte, al abrir un PDF`);
    }
  }
  // Versión exacta (sin ^ ni ~): una actualización no puede mover el tope sin un cambio a la vista.
  const pinned = JSON.parse(fs.readFileSync(path.resolve("package.json"), "utf8")).dependencies?.["pdfjs-dist"];
  if (!/^\d+\.\d+\.\d+$/.test(pinned ?? ""))
    fail(`package.json: pdfjs-dist debe ir con versión exacta (tiene "${pinned}")`);
  const sw = fs.readFileSync(path.join(DIST, "service-worker.js"), "utf8");
  for (const file of pdfjsFiles) {
    if (sw.includes(path.basename(file))) fail(`service-worker.js precachea ${path.basename(file)}`);
  }
}

if (/fonts\.googleapis|fonts\.gstatic/.test(html)) {
  console.log("  EXCEDE index.html vuelve a cargar fuentes de Google (se autoalojan: src/styles/fonts.css)");
  failed = true;
}
// El manifest solo sirve para medir: no se publica (expone rutas de src/).
fs.rmSync(path.join(DIST, ".vite"), { recursive: true, force: true });
process.exit(failed ? 1 : 0);

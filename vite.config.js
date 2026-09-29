import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// Fuentes que se usan en la primera pintura (texto del login y títulos):
// se precargan para que no esperen a que el navegador descubra el CSS.
const PRELOAD_FONTS = [/inter-latin-wght-normal-[\w-]+\.woff2$/, /source-serif-4-latin-600-normal-[\w-]+\.woff2$/];

/**
 * Inserta <link rel="preload" as="font"> con el nombre FINAL (con hash) de
 * cada fuente. Solo en el build: en desarrollo Vite sirve los archivos sin hash.
 */
function preloadFonts() {
  return {
    name: "renta-ia:preload-fonts",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        return Object.keys(ctx.bundle)
          .filter((file) => PRELOAD_FONTS.some((regex) => regex.test(file)))
          .map((file) => ({
            tag: "link",
            attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" },
            injectTo: "head",
          }));
      },
    },
  };
}

/**
 * Emite /service-worker.js en cada build a partir de src/sw/service-worker.js,
 * con el id del build y la lista real de archivos a precachear. El id es un
 * hash de los nombres del bundle (que ya llevan hash de contenido): cambia
 * solo si cambió algo, y así el navegador detecta la versión nueva.
 * En desarrollo no hay Service Worker (ver src/sw/registerSW.js).
 */
function serviceWorker() {
  return {
    name: "renta-ia:service-worker",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((file) => !file.endsWith(".map"))
        .sort();
      const template = fs.readFileSync(path.resolve("src/sw/service-worker.js"), "utf8");
      // El id cambia si cambia el bundle O el propio código del Service Worker.
      const buildId = createHash("sha256").update(files.join("\n")).update(template).digest("hex").slice(0, 12);
      const precache = [
        "/index.html",
        "/offline.html",
        "/favicon.svg",
        ...files.filter((file) => file.startsWith("assets/")).map((f) => `/${f}`),
      ];
      const source = template
        .replace('const BUILD_ID = "__BUILD_ID__";', `const BUILD_ID = "${buildId}";`)
        .replace("const PRECACHE_URLS = __PRECACHE_URLS__;", `const PRECACHE_URLS = ${JSON.stringify(precache)};`);
      if (source.includes('"__BUILD_ID__"') || source.includes("= __PRECACHE_URLS__;")) {
        throw new Error("service-worker.js: no se pudieron reemplazar __BUILD_ID__ / __PRECACHE_URLS__");
      }
      this.emitFile({ type: "asset", fileName: "service-worker.js", source });
    },
  };
}

/**
 * Content-Security-Policy estricta (docs/threat-model.md, "XSS"), como
 * <meta> en el index.html del build. Sin 'unsafe-inline' ni 'unsafe-eval':
 * solo se ejecuta JavaScript servido por la propia app, y solo se puede
 * hablar con la API (HTTP y WebSocket) indicada en VITE_API_URL.
 * En desarrollo no se aplica: el cliente de Vite (HMR) inyecta estilos y
 * scripts en línea.
 * Limitación de <meta>: no admite frame-ancestors ni report-uri; en
 * producción, el servidor que sirva el frontend debe enviar además el
 * encabezado "Content-Security-Policy: frame-ancestors 'none'" (anti
 * clickjacking). Queda documentado para el despliegue.
 */
export function buildCsp(apiUrl) {
  const api = new URL(apiUrl);
  const ws = `${api.protocol === "https:" ? "wss:" : "ws:"}//${api.host}`;
  return [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self' ${api.origin} ${ws}`,
    "worker-src 'self'",
    "manifest-src 'self'",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join("; ");
}

function contentSecurityPolicy(apiUrl) {
  return {
    name: "renta-ia:csp",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: buildCsp(apiUrl) },
          injectTo: "head-prepend",
        },
      ];
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [
    preloadFonts(),
    serviceWorker(),
    contentSecurityPolicy(loadEnv(mode, process.cwd(), "VITE_").VITE_API_URL || "http://localhost:4000"),
  ],
  server: {
    port: 5173,
  },
  build: {
    // Las fuentes nunca se incrustan como base64 dentro del CSS (bloquearían
    // su descarga y no se podrían precargar ni cachear aparte).
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    restoreMocks: true,
  },
}));

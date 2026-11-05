// @vitest-environment node
import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Configuración de Vercel (vercel.json). Sujeta lo que exigen docs/security.md y
 * docs/cache-policy.md para el despliegue: frame-ancestors como CABECERA (en <meta> no
 * funciona) y la caché de los assets con hash frente a los archivos que los apuntan.
 */
const config = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));

/** Cabeceras que Vercel aplicaría a `path` (todas las reglas cuyo source coincide, en orden). */
function headersFor(path) {
  const out = {};
  for (const rule of config.headers) {
    if (new RegExp(`^${rule.source}$`).test(path)) {
      for (const { key, value } of rule.headers) out[key.toLowerCase()] = value;
    }
  }
  return out;
}

describe("vercel.json", () => {
  it("construye con npm ci + npm run build (incluye el control de tamaño) y publica dist", () => {
    expect(config).toMatchObject({
      framework: "vite",
      installCommand: "npm ci",
      buildCommand: "npm run build",
      outputDirectory: "dist",
    });
  });

  it("no lleva variables ni dominios: VITE_API_URL va en el proyecto de Vercel", () => {
    const raw = JSON.stringify(config);
    expect(config.env).toBeUndefined();
    expect(config.build).toBeUndefined();
    expect(raw).not.toMatch(/VITE_API_URL|https?:\/\/(?!openapi\.vercel\.sh)/);
  });

  it("toda respuesta lleva frame-ancestors 'none' y X-Frame-Options DENY (anti clickjacking)", () => {
    for (const path of ["/", "/index.html", "/assets/index-abc123.js", "/offline.html"]) {
      const h = headersFor(path);
      expect(h["content-security-policy"], path).toBe("frame-ancestors 'none'");
      expect(h["x-frame-options"], path).toBe("DENY");
      expect(h["x-content-type-options"], path).toBe("nosniff");
      expect(h["strict-transport-security"], path).toMatch(/^max-age=\d{8,}/);
    }
  });

  it("la CSP de cabecera no reemplaza a la del <meta>: solo agrega frame-ancestors", () => {
    // Si esta cabecera llevara default-src o connect-src, se SUMARÍA a la del <meta> (las dos
    // se aplican) y podría bloquear la API. La política completa sigue en buildCsp.
    expect(headersFor("/")["content-security-policy"]).not.toMatch(/default-src|script-src|connect-src/);
  });

  it("assets con hash: inmutables por un año", () => {
    expect(headersFor("/assets/index-BaoOQ32D.js")["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(headersFor("/assets/inter-latin-wght-normal-abc.woff2")["cache-control"]).toBe(
      "public, max-age=31536000, immutable"
    );
  });

  it("lo que apunta a los assets nuevos se revalida siempre (no-cache)", () => {
    for (const path of ["/", "/index.html", "/service-worker.js", "/offline.html"]) {
      expect(headersFor(path)["cache-control"], path).toBe("no-cache");
    }
  });

  it("nada fuera de /assets/ queda inmutable", () => {
    expect(headersFor("/favicon.svg")["cache-control"]).toBeUndefined();
    expect(headersFor("/service-worker.js")["cache-control"]).not.toMatch(/immutable/);
  });
});

import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Política de movimiento (docs/dark-mode.md §Movimiento, decisión D4):
 *  - UNA sola animación con movimiento continuo en todo el sistema: el
 *    indicador "procesando con IA" (clase .ai-processing). Todo lo demás son
 *    transiciones cortas disparadas por el usuario o micro-interacciones de
 *    una sola vez (sin "infinite").
 *  - prefers-reduced-motion: reduce anula duraciones de animaciones y
 *    transiciones en toda la app (base.css).
 */
const ROOT = path.resolve(__dirname, "..");
const STYLES = path.join(ROOT, "src/styles");
const css = Object.fromEntries(
  fs
    .readdirSync(STYLES)
    .filter((f) => f.endsWith(".css"))
    .map((f) => [f, fs.readFileSync(path.join(STYLES, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "")])
);

/** Reglas (selector + cuerpo) de primer nivel o dentro de @media. */
const rules = (text) => [...text.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));

describe("política de movimiento", () => {
  it("solo .ai-processing puede animarse de forma continua", () => {
    const continuous = Object.entries(css).flatMap(([file, text]) =>
      rules(text)
        .filter((r) => /\binfinite\b/.test(r.body))
        .filter((r) => !/^\.ai-processing(\b|::)/.test(r.selector))
        .map((r) => `${file}: ${r.selector}`)
    );
    expect(continuous).toEqual([]);
  });

  it("ningún script anima en bucle (requestAnimationFrame recursivo o setInterval de estilo)", () => {
    const src = path.join(ROOT, "src");
    const files = fs
      .readdirSync(src, { recursive: true })
      .filter((f) => f.endsWith(".js"))
      .map((f) => [f, fs.readFileSync(path.join(src, f), "utf8")]);
    const hits = files.filter(([, text]) => /\.animate\(|iterations:\s*Infinity/.test(text)).map(([f]) => f);
    expect(hits).toEqual([]);
  });

  it("prefers-reduced-motion anula animaciones y transiciones en toda la app", () => {
    const reduced = css["base.css"].match(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{([\s\S]*?\})\s*\}/);
    expect(reduced, "falta el bloque prefers-reduced-motion en base.css").not.toBeNull();
    expect(reduced[1]).toMatch(/animation-duration:\s*0\.001ms\s*!important/);
    expect(reduced[1]).toMatch(/animation-iteration-count:\s*1\s*!important/);
    expect(reduced[1]).toMatch(/transition-duration:\s*0\.001ms\s*!important/);
  });
});

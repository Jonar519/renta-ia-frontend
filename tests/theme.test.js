import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTokens } from "../scripts/contrast.mjs";

/**
 * Regla de tema: la app sigue SOLO el tema del sistema operativo
 * (prefers-color-scheme) con CSS puro. No hay selector manual, ni
 * preferencia guardada, ni JavaScript que decida el tema.
 */
const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

function filesUnder(dir, ext) {
  return fs
    .readdirSync(path.join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(ext))
    .map((entry) => path.relative(ROOT, path.join(entry.parentPath, entry.name)).replaceAll("\\", "/"));
}

const JS_FILES = filesUnder("src", ".js");
const CSS_FILES = filesUnder("src", ".css");
const COMPONENT_CSS = ["src/styles/base.css", "src/styles/layout.css", "src/styles/components.css"];

// Primitivos que los componentes pueden usar directamente porque NO dependen
// del tema: texto blanco sobre rellenos que son oscuros en ambos temas, el
// degradado del login, el skip-link, el sidebar y los toasts de éxito/error.
const THEME_INVARIANT_PRIMITIVES = new Set([
  "--color-white",
  "--color-navy-800",
  "--color-navy-900",
  "--color-navy-950",
  "--color-slate-200",
  "--color-green-700",
  "--color-red-700",
]);

describe("regla de tema", () => {
  it("ningún JavaScript consulta, decide ni guarda el tema", () => {
    const forbidden = [
      /prefers-color-scheme/i,
      /color-?scheme/i,
      /data-theme/i,
      /\.dataset\.theme/i,
      /(localStorage|sessionStorage|indexedDB)[\s\S]{0,120}theme/i,
      /classList\.(add|toggle|remove)\(\s*["'`](dark|light|theme)/i,
    ];
    const hits = JS_FILES.flatMap((file) =>
      forbidden.filter((regex) => regex.test(read(file))).map((regex) => `${file}: ${regex}`)
    );
    expect(hits).toEqual([]);
    expect(read("index.html")).not.toMatch(/<script(?![^>]*type="module"[^>]*src=)/);
  });

  it("no hay selectores de tema manual en el CSS", () => {
    const hits = CSS_FILES.filter((file) =>
      /\[data-theme|\.theme-|:root\.(dark|light)|\.dark\b|\.light\b/.test(read(file))
    );
    expect(hits).toEqual([]);
  });

  it("el tema oscuro vive solo en tokens.css, con @media (prefers-color-scheme)", () => {
    const withMedia = CSS_FILES.filter((file) => read(file).includes("prefers-color-scheme"));
    expect(withMedia).toEqual(["src/styles/tokens.css"]);
    expect(read("index.html")).toContain('<meta name="color-scheme" content="light dark" />');
    expect(read("src/styles/tokens.css")).toMatch(/color-scheme:\s*light dark/);
  });

  it("cada token semántico del tema claro se redefine en el oscuro (y solo esos)", () => {
    const { light, dark } = parseTokens(read("src/styles/tokens.css"));
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  it("los componentes usan tokens semánticos, no colores literales ni primitivos que cambian con el tema", () => {
    const { primitives } = parseTokens(read("src/styles/tokens.css"));
    const problems = [];
    for (const file of COMPONENT_CSS) {
      const css = read(file).replace(/\/\*[\s\S]*?\*\//g, "");
      for (const [hex] of css.matchAll(/#[0-9a-f]{3,8}\b/gi)) problems.push(`${file}: color literal ${hex}`);
      for (const [, name] of css.matchAll(/var\((--[\w-]+)\)/g)) {
        if (name in primitives && name.startsWith("--color-") && !THEME_INVARIANT_PRIMITIVES.has(name)) {
          problems.push(`${file}: usa el primitivo ${name}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });
});

/**
 * Contraste WCAG 2.x de cada par de colores de la interfaz, en tema claro y
 * oscuro, calculado A PARTIR DE src/styles/tokens.css (no de una copia de los
 * valores): evalúa var() y color-mix(in srgb, …) igual que el navegador.
 *
 *   node scripts/contrast.mjs        → tabla Markdown (docs/dark-mode.md)
 *   tests/contrast.test.js           → falla si algún par queda bajo el mínimo
 *
 * Mínimos: 4.5:1 texto normal (WCAG 1.4.3) y 3:1 para elementos gráficos y
 * límites de controles (WCAG 1.4.11).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const TEXT = 4.5;
export const GRAPHIC = 3;

const DARK_BLOCK = /@media\s*\(prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}\s*\}/;

const declarations = (body) =>
  Object.fromEntries([...body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));

/** Bloques de declaraciones: [primitivos, semánticos claros, semánticos oscuros]. */
export function parseTokens(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const dark = clean.match(DARK_BLOCK);
  if (!dark) throw new Error("tokens.css: falta el bloque @media (prefers-color-scheme: dark)");
  const outside = clean.replace(dark[0], "");
  const roots = [...outside.matchAll(/:root\s*\{([^}]*)\}/g)].map((m) => m[1]);
  if (roots.length !== 2) throw new Error("tokens.css: se esperaban dos bloques :root (primitivos y semánticos)");
  return { primitives: declarations(roots[0]), light: declarations(roots[1]), dark: declarations(dark[1]) };
}

export function loadThemes(file = path.join(ROOT, "src/styles/tokens.css")) {
  const { primitives, light, dark } = parseTokens(fs.readFileSync(file, "utf8"));
  return {
    tokens: { primitives, light, dark },
    light: { ...primitives, ...light },
    dark: { ...primitives, ...light, ...dark },
  };
}

/** Separa por comas de primer nivel (fuera de paréntesis). */
function splitArgs(text) {
  const out = [];
  let depth = 0;
  let current = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(current.trim());
      current = "";
    } else current += ch;
  }
  out.push(current.trim());
  return out;
}

/** Evalúa una expresión de color CSS a [r, g, b, a] (r/g/b en 0-255). */
export function evaluate(expr, vars, seen = new Set()) {
  const value = expr.trim();
  let m;
  if ((m = value.match(/^var\((--[\w-]+)\)$/))) {
    if (seen.has(m[1])) throw new Error(`Referencia circular en ${m[1]}`);
    if (!(m[1] in vars)) throw new Error(`Token no definido: ${m[1]}`);
    return evaluate(vars[m[1]], vars, new Set([...seen, m[1]]));
  }
  if ((m = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i))) {
    const hex = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
    return [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)).concat(1);
  }
  if ((m = value.match(/^rgba?\(([^)]*)\)$/))) {
    const [r, g, b, a = "1"] = m[1].split(/[\s,/]+/).filter(Boolean);
    return [Number(r), Number(g), Number(b), Number(a)];
  }
  if ((m = value.match(/^color-mix\(\s*in srgb\s*,(.*)\)$/s))) {
    const [first, second] = splitArgs(m[1]).map((part) => {
      const pct = part.match(/\s(\d+(?:\.\d+)?)%$/);
      return { color: pct ? part.slice(0, pct.index) : part, pct: pct ? Number(pct[1]) / 100 : null };
    });
    let p1 = first.pct ?? (second.pct === null ? 0.5 : 1 - second.pct);
    let p2 = second.pct ?? 1 - p1;
    const sum = p1 + p2;
    p1 /= sum;
    p2 /= sum;
    const a = evaluate(first.color, vars, seen);
    const b = evaluate(second.color, vars, seen);
    // Interpolación con alfa premultiplicado (CSS Color 5, §color-mix).
    const alpha = a[3] * p1 + b[3] * p2;
    const rgb = [0, 1, 2].map((i) => (alpha === 0 ? 0 : (a[i] * a[3] * p1 + b[i] * b[3] * p2) / alpha));
    return [...rgb, alpha];
  }
  throw new Error(`Expresión de color no soportada: ${value}`);
}

/** Compone un color con transparencia sobre un fondo opaco. */
function over([r, g, b, a], [br, bg, bb]) {
  return [r * a + br * (1 - a), g * a + bg * (1 - a), b * a + bb * (1 - a), 1];
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(fg, bg) {
  const solidBg = bg[3] < 1 ? over(bg, [255, 255, 255]) : bg;
  const solidFg = fg[3] < 1 ? over(fg, solidBg) : fg;
  const [hi, lo] = [luminance(solidFg), luminance(solidBg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export const toHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

const v = (name) => `var(--${name})`;

/**
 * Pares que la interfaz realmente pinta: [descripción, texto/elemento, fondo, mínimo].
 * Al agregar un componente con un par nuevo, se agrega aquí.
 */
export const PAIRS = [
  ["Texto principal / fondo de la app", v("text"), v("bg-app"), TEXT],
  ["Texto principal / superficie (paneles, inputs)", v("text"), v("bg-surface"), TEXT],
  ["Texto secundario / fondo de la app", v("text-muted"), v("bg-app"), TEXT],
  ["Texto secundario / superficie", v("text-muted"), v("bg-surface"), TEXT],
  ["Títulos / fondo de la app", v("text-strong"), v("bg-app"), TEXT],
  ["Títulos / superficie", v("text-strong"), v("bg-surface"), TEXT],
  ["Enlace / fondo de la app", v("text-link"), v("bg-app"), TEXT],
  ["Enlace / superficie", v("text-link"), v("bg-surface"), TEXT],
  ["Error de formulario / superficie", v("tone-error-fg"), v("bg-surface"), TEXT],
  ["Botón primario: texto / fondo", v("color-white"), v("action-bg"), TEXT],
  ["Botón primario (hover): texto / fondo", v("color-white"), v("action-bg-hover"), TEXT],
  ["Chat, burbuja del usuario: texto / fondo", v("color-white"), v("action-bg"), TEXT],
  ["Chat, burbuja de la IA: texto / fondo IA", v("text"), v("tone-ai-bg"), TEXT],
  ["Resumen IA: texto / fondo IA", v("text"), v("tone-ai-bg"), TEXT],
  ["Badge neutro", v("tone-neutral-fg"), v("tone-neutral-bg"), TEXT],
  ["Badge info (Procesando, Abierta)", v("tone-info-fg"), v("tone-info-bg"), TEXT],
  ["Badge éxito (Procesado, Resuelta)", v("tone-success-fg"), v("tone-success-bg"), TEXT],
  ["Badge advertencia / banner sin conexión", v("tone-warning-fg"), v("tone-warning-bg"), TEXT],
  ["Badge error / burbuja de error", v("tone-error-fg"), v("tone-error-bg"), TEXT],
  ["Badge IA", v("tone-ai-fg"), v("tone-ai-bg"), TEXT],
  ['Login: etiqueta "Ejemplo" de la ilustración', v("bg-surface"), v("text-strong"), TEXT],
  ["Login: borde IA de la tarjeta / superficie", v("tone-ai-fg"), v("bg-surface"), GRAPHIC],
  ["Toast informativo", v("color-white"), v("toast-bg"), TEXT],
  ["Toast de éxito", v("color-white"), v("color-green-700"), TEXT],
  ["Toast de error", v("color-white"), v("color-red-700"), TEXT],
  ["Toast de advertencia (conexión perdida)", v("color-white"), v("color-amber-800"), TEXT],
  ["Estado de error: título / superficie", v("tone-error-fg"), v("bg-surface"), TEXT],
  ["Estado vacío: orientación / superficie", v("text-muted"), v("bg-surface"), TEXT],
  ["Sidebar: enlace / fondo", v("color-slate-200"), v("sidebar-bg"), TEXT],
  [
    "Sidebar: enlace activo / fondo + 12 % blanco",
    v("color-white"),
    `color-mix(in srgb, ${v("color-white")} 12%, ${v("sidebar-bg")})`,
    TEXT,
  ],
  ["Skip-link: texto / fondo", v("color-white"), v("color-navy-900"), TEXT],
  ["Menú de usuario: iniciales / avatar", v("color-white"), v("color-navy-800"), TEXT],
  ["Menú de usuario: rol / sidebar", v("color-slate-200"), v("sidebar-bg"), TEXT],
  ["Menú de usuario: opción con foco / fondo", v("text"), v("bg-app"), TEXT],
  ["Aviso de rebote: texto / fondo", v("tone-warning-fg"), v("tone-warning-bg"), TEXT],
  ["Botón Cancelar (peligro): texto / superficie", v("tone-error-fg"), v("bg-surface"), TEXT],
  ["Mostrar contraseña: texto / superficie", v("text-link"), v("bg-surface"), TEXT],
  ["Mostrar contraseña (activado): texto / fondo", v("tone-info-fg"), v("tone-info-bg"), TEXT],
  ["Campo de solo lectura: texto / fondo", v("text-muted"), v("bg-app"), TEXT],
  ["Anillo de foco / superficie", v("focus-ring"), v("bg-surface"), GRAPHIC],
  ["Anillo de foco / fondo de la app", v("focus-ring"), v("bg-app"), GRAPHIC],
  ["Contorno de input / superficie", v("border-control"), v("bg-surface"), GRAPHIC],
  ["Contorno de input / fondo de la app", v("border-control"), v("bg-app"), GRAPHIC],
  ["Pestaña activa (subrayado) / fondo de la app", v("accent-indicator"), v("bg-app"), GRAPHIC],
  ["Pestaña activa (subrayado) / superficie", v("accent-indicator"), v("bg-surface"), GRAPHIC],
  ["Filete del resumen IA / superficie", v("ai-accent"), v("bg-surface"), GRAPHIC],
];

/**
 * public/offline.html es una página estática aparte (sin el CSS de la app):
 * sus colores se leen de su propio <style> (:root + @media oscuro).
 */
export const OFFLINE_FOCUS = "#b9770e";
export const OFFLINE_PAIRS = [
  ["offline.html: título / fondo", v("text"), v("bg"), TEXT],
  ["offline.html: texto / fondo", v("muted"), v("bg"), TEXT],
  ["offline.html: botón texto / fondo", v("button-text"), v("button-bg"), TEXT],
  ["offline.html: foco / fondo", OFFLINE_FOCUS, v("bg"), GRAPHIC],
];

export function loadOfflineThemes(file = path.join(ROOT, "public/offline.html")) {
  const css = fs
    .readFileSync(file, "utf8")
    .match(/<style>([\s\S]*)<\/style>/)[1]
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const dark = css.match(DARK_BLOCK);
  const light = dark && css.replace(dark[0], "").match(/:root\s*\{([^}]*)\}/);
  if (!light) throw new Error("offline.html: faltan :root y @media (prefers-color-scheme: dark)");
  return { light: declarations(light[1]), dark: { ...declarations(light[1]), ...declarations(dark[1]) } };
}

export function measure(themes = loadThemes(), offline = loadOfflineThemes()) {
  const rows = [];
  for (const theme of ["light", "dark"]) {
    for (const [pairs, vars] of [
      [PAIRS, themes[theme]],
      [OFFLINE_PAIRS, offline[theme]],
    ]) {
      for (const [label, fgExpr, bgExpr, min] of pairs) {
        const fg = evaluate(fgExpr, vars);
        const bg = evaluate(bgExpr, vars);
        rows.push({ theme, label, fg: toHex(fg), bg: toHex(bg), ratio: contrast(fg, bg), min });
      }
    }
  }
  return rows;
}

function table(rows) {
  const lines = [
    "| Par | Color | Fondo | Medido | Mínimo exigido | Resultado |",
    "| --- | --- | --- | --- | --- | --- |",
  ];
  for (const r of rows) {
    const ok = r.ratio >= r.min;
    lines.push(
      `| ${r.label} | \`${r.fg}\` | \`${r.bg}\` | ${r.ratio.toFixed(2)}:1 | ${r.min}:1 | ${ok ? "Cumple" : "**No cumple**"} |`
    );
  }
  return lines.join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const rows = measure();
  for (const theme of ["dark", "light"]) {
    console.log(`\n### Tema ${theme === "dark" ? "oscuro" : "claro"}\n`);
    console.log(table(rows.filter((r) => r.theme === theme)));
  }
  const failing = rows.filter((r) => r.ratio < r.min);
  if (failing.length) {
    console.error(`\n${failing.length} par(es) bajo el mínimo.`);
    process.exit(1);
  }
}

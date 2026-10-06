import { describe, expect, it } from "vitest";
import { contrast, evaluate, loadThemes, measure, PAIRS, TEXT } from "../scripts/contrast.mjs";

/**
 * Contraste WCAG AA de cada par de colores en ambos temas, calculado desde
 * src/styles/tokens.css (y public/offline.html). Si un cambio de tokens deja
 * un par bajo el mínimo, este test lo nombra.
 */
describe("contraste AA (scripts/contrast.mjs)", () => {
  it("todos los pares cumplen el mínimo en tema claro y oscuro", () => {
    const rows = measure();
    const failing = rows
      .filter((r) => r.ratio < r.min)
      .map((r) => `[${r.theme}] ${r.label}: ${r.ratio.toFixed(2)}:1 < ${r.min}:1`);
    expect(failing).toEqual([]);
    expect(rows.filter((r) => r.theme === "dark")).toHaveLength(rows.length / 2);
  });

  it("los pares de texto exigen 4.5:1 y los gráficos 3:1", () => {
    for (const [label, , , min] of PAIRS) {
      expect([3, 4.5], label).toContain(min);
    }
    expect(PAIRS.filter(([, , , min]) => min === TEXT).length).toBeGreaterThan(20);
  });

  // El evaluador debe dar lo mismo que la fórmula de WCAG con valores
  // conocidos (medidos aparte en docs/design-tokens-audit.md).
  it("el evaluador reproduce valores de referencia", () => {
    const { light } = loadThemes();
    expect(contrast(evaluate("var(--text)", light), evaluate("var(--bg-app)", light))).toBeCloseTo(13.4, 1);
    expect(contrast(evaluate("#ffffff", {}), evaluate("#000000", {}))).toBeCloseTo(21, 5);
    // color-mix en srgb: mitad blanco, mitad negro = gris 127.5.
    expect(evaluate("color-mix(in srgb, #ffffff 50%, #000000)", {})[0]).toBeCloseTo(127.5, 5);
    // El porcentaje omitido es el complemento del otro.
    expect(evaluate("color-mix(in srgb, #ffffff, #000000 25%)", {})[0]).toBeCloseTo(191.25, 5);
  });
});

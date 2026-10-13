import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * axe en la pantalla actual, en tema claro Y oscuro (el tema lo decide el
 * sistema operativo: aquí se emula con prefers-color-scheme, sin recargar).
 * Falla ante violaciones "serious" o "critical" (WCAG 2.1 A/AA). Deja la
 * página en el tema en que estaba.
 */
export async function expectNoSeriousA11yViolations(page, testInfo, name) {
  const original = await page.evaluate(() => (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  const problems = [];
  for (const colorScheme of ["light", "dark"]) {
    await page.emulateMedia({ colorScheme });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"]).analyze();
    await testInfo.attach(`axe-${name}-${colorScheme}.json`, {
      body: JSON.stringify(results.violations, null, 2),
      contentType: "application/json",
    });
    for (const v of results.violations) {
      if (v.impact !== "serious" && v.impact !== "critical") continue;
      problems.push(`[${colorScheme}] ${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`);
    }
  }
  await page.emulateMedia({ colorScheme: original });
  expect(problems, `Violaciones de accesibilidad en ${name}`).toEqual([]);
}

/**
 * Totales de conceptos tributarios por año gravable y tipo.
 * Función pura: la usa el Web Worker (listas grandes) y el hilo principal
 * (listas pequeñas, donde crear el worker cuesta más que sumar).
 *
 * @param {{ conceptType: string, amount: string | number, periodYear: number }[]} concepts
 * @returns {{ periodYear: number, count: number, totals: Record<string, number> }[]}  años de mayor a menor
 */
export function aggregateConcepts(concepts) {
  const byYear = new Map();
  for (const c of concepts) {
    let entry = byYear.get(c.periodYear);
    if (!entry) {
      entry = { periodYear: c.periodYear, count: 0, totals: {} };
      byYear.set(c.periodYear, entry);
    }
    entry.count++;
    // En centavos para no acumular errores de punto flotante.
    entry.totals[c.conceptType] = (entry.totals[c.conceptType] ?? 0) + Math.round(Number(c.amount) * 100);
  }
  return [...byYear.values()]
    .sort((a, b) => b.periodYear - a.periodYear)
    .map((e) => ({ ...e, totals: Object.fromEntries(Object.entries(e.totals).map(([k, v]) => [k, v / 100])) }));
}

/**
 * Espera antes del reintento número `attempt` (0, 1, 2…): crece
 * exponencialmente hasta `max` y se "reparte" con jitter para que muchos
 * navegadores que perdieron la conexión a la vez (p. ej. al reiniciar la
 * API) no se reconecten todos en el mismo instante ("equal jitter": entre
 * la mitad y el total del valor exponencial).
 */
export function backoffDelay(attempt, { base = 1000, max = 30_000, random = Math.random } = {}) {
  const exponential = Math.min(max, base * 2 ** attempt);
  return Math.round(exponential / 2 + random() * (exponential / 2));
}

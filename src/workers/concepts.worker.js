import { aggregateConcepts } from "../utils/aggregateConcepts.js";

/**
 * Worker de agregación de conceptos tributarios (listas grandes).
 *
 * @typedef {{ type: "aggregate", id: number, concepts: { conceptType: string, amount: string | number, periodYear: number }[] }} AggregateRequest
 * @typedef {{ type: "aggregate:result", id: number, result: ReturnType<typeof aggregateConcepts> }} AggregateResult
 * @typedef {{ type: "aggregate:error", id: number, message: string }} AggregateError
 */
self.onmessage = (event) => {
  /** @type {AggregateRequest} */
  const message = event.data;
  if (message.type !== "aggregate") {
    self.postMessage({
      type: `${message.type}:error`,
      id: message.id,
      message: `Tipo de mensaje desconocido: ${message.type}`,
    });
    return;
  }
  try {
    self.postMessage({ type: "aggregate:result", id: message.id, result: aggregateConcepts(message.concepts) });
  } catch (err) {
    self.postMessage({ type: "aggregate:error", id: message.id, message: String(err?.message ?? err) });
  }
};

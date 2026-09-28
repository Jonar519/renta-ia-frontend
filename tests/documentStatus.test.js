import { describe, expect, it } from "vitest";
import { canReprocess, documentStatus, isPending } from "../src/views/clientDetail/labels.js";

describe("documentStatus", () => {
  it("processed sin errorMessage => Procesado (success)", () => {
    expect(documentStatus({ status: "processed", errorMessage: null })).toEqual({ text: "Procesado", tone: "success" });
  });

  it("processed con errorMessage => Procesado con advertencias (warning) y muestra el detalle", () => {
    const s = documentStatus({ status: "processed", errorMessage: "Procesado con advertencias: embeddings" });
    expect(s).toMatchObject({ text: "Procesado con advertencias", tone: "warning" });
    expect(s.detail).toBe("embeddings"); // sin el prefijo repetido
  });

  it("error => Error al procesar (error), distinto de las advertencias", () => {
    const s = documentStatus({ status: "error", errorMessage: "El PDF no tiene texto extraíble" });
    expect(s).toMatchObject({ text: "Error al procesar", tone: "error", detail: "El PDF no tiene texto extraíble" });
  });

  it("uploaded (en la cola) y processing", () => {
    expect(documentStatus({ status: "uploaded" }).text).toBe("En cola");
    expect(documentStatus({ status: "processing" }).text).toBe("Procesando");
  });
});

describe("canReprocess / isPending", () => {
  it("solo se puede reintentar un documento con error o con advertencias", () => {
    expect(canReprocess({ status: "error", errorMessage: "x" })).toBe(true);
    expect(canReprocess({ status: "processed", errorMessage: "Procesado con advertencias: x" })).toBe(true);
    expect(canReprocess({ status: "processed", errorMessage: null })).toBe(false);
    expect(canReprocess({ status: "uploaded", errorMessage: null })).toBe(false);
    expect(canReprocess({ status: "processing", errorMessage: null })).toBe(false);
  });

  it("pendiente = en cola o procesando", () => {
    expect(["uploaded", "processing", "processed", "error"].map((status) => isPending({ status }))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });
});

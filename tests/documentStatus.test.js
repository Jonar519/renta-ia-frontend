import { describe, expect, it, vi } from "vitest";

// La vista importa módulos con efectos (Worker, APIs); solo se prueba la función pura.
vi.mock("../src/api/http.js", () => ({ http: {}, LONG_TIMEOUT_MS: 60000 }));
const { documentStatus } = await import("../src/views/clientDetail.view.js");

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

  it("uploaded y processing", () => {
    expect(documentStatus({ status: "uploaded" }).text).toBe("Subido");
    expect(documentStatus({ status: "processing" }).text).toBe("Procesando");
  });
});

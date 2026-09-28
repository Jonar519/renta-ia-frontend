export const DOC_TYPE_LABELS = {
  income_certificate: "Certificado de ingresos",
  bank_statement: "Extracto bancario",
  deductible_invoice: "Factura deducible",
  exogenous_info: "Información exógena",
  pension_certificate: "Certificado de pensión/salud",
  other: "Otro",
};

export const CONCEPT_LABELS = {
  gross_income: "Ingreso bruto",
  withholding: "Retención",
  deduction: "Deducción",
  pension_contribution: "Aporte a pensión",
  health_contribution: "Aporte a salud",
  other: "Otro",
};

export const SEVERITY_LABELS = { low: "Baja", medium: "Media", high: "Alta", critical: "Crítica" };
export const SEVERITY_TONES = { low: "neutral", medium: "info", high: "warning", critical: "error" };

export const ALERT_TYPE_LABELS = { deadline: "Vencimiento", inconsistency: "Inconsistencia" };
export const ALERT_STATUS = {
  open: { text: "Abierta", tone: "info" },
  acknowledged: { text: "Vista", tone: "neutral" },
  resolved: { text: "Resuelta", tone: "success" },
};

/**
 * Estado visible de un documento. "error" y "processed con advertencias"
 * son cosas distintas en el backend:
 *  - error: falló la extracción de texto; no se pudo analizar nada.
 *  - processed + errorMessage: se leyó el texto, pero alguna etapa de IA
 *    (conceptos o embeddings) falló; el resto sí quedó guardado.
 */
export function documentStatus(doc) {
  switch (doc.status) {
    case "uploaded":
      return { text: "En cola", tone: "neutral" };
    case "processing":
      return { text: "Procesando", tone: "info" };
    case "processed":
      return doc.errorMessage
        ? {
            text: "Procesado con advertencias",
            tone: "warning",
            // El backend antepone "Procesado con advertencias: "; el badge ya lo dice.
            detail: doc.errorMessage.replace(/^Procesado con advertencias:\s*/, ""),
          }
        : { text: "Procesado", tone: "success" };
    case "error":
      return { text: "Error al procesar", tone: "error", detail: doc.errorMessage };
    default:
      return { text: doc.status, tone: "neutral" };
  }
}

/** ¿Se puede reintentar el análisis? Solo si terminó con error o con advertencias. */
export function canReprocess(doc) {
  return doc.status === "error" || (doc.status === "processed" && Boolean(doc.errorMessage));
}

export function isPending(doc) {
  return doc.status === "uploaded" || doc.status === "processing";
}

export const formatCOP = (value) => `$${Number(value).toLocaleString("es-CO", { maximumFractionDigits: 0 })}`;

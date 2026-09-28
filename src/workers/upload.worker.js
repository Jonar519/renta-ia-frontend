/**
 * Worker de subida de documentos: valida el archivo y calcula su huella
 * SHA-256 fuera del hilo principal (un PDF de 15 MB tardaría cientos de ms
 * en el hilo de la UI y bloquearía clics y animaciones).
 *
 * Mensajes (ver workers/workerClient.js):
 * @typedef {{ type: "validate", id: number, name: string, size: number }} ValidateRequest
 * @typedef {{ type: "validate:result", id: number, result: { valid: boolean, errors: string[] } }} ValidateResult
 * @typedef {{ type: "hash", id: number, file: File }} HashRequest
 * @typedef {{ type: "hash:result", id: number, result: { sha256: string } }} HashResult
 * @typedef {{ type: `${string}:error`, id: number, message: string }} ErrorResult
 */

export const MAX_SIZE_BYTES = 15 * 1024 * 1024;
export const ALLOWED_EXTENSIONS = ["pdf", "png", "jpg", "jpeg"];

export function validateFile(name, size) {
  const ext = (name.split(".").pop() || "").toLowerCase();
  const errors = [];
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    errors.push(`Tipo de archivo no permitido: .${ext}. Usa PDF, PNG o JPG.`);
  }
  if (size > MAX_SIZE_BYTES) {
    errors.push(`El archivo pesa ${(size / (1024 * 1024)).toFixed(1)} MB; el máximo permitido es 15 MB.`);
  }
  return { valid: errors.length === 0, errors };
}

export async function sha256Hex(blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Solo dentro de un Worker (en los tests se importan las funciones puras).
if (typeof WorkerGlobalScope !== "undefined" && self instanceof WorkerGlobalScope) {
  self.onmessage = async (event) => {
    const { type, id } = event.data;
    try {
      if (type === "validate") {
        self.postMessage({ type: "validate:result", id, result: validateFile(event.data.name, event.data.size) });
      } else if (type === "hash") {
        self.postMessage({ type: "hash:result", id, result: { sha256: await sha256Hex(event.data.file) } });
      } else {
        throw new Error(`Tipo de mensaje desconocido: ${type}`);
      }
    } catch (err) {
      self.postMessage({ type: `${type}:error`, id, message: String(err?.message ?? err) });
    }
  };
}

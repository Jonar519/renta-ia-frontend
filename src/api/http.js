import { getState, clearAuth } from "../state/store.js";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Tiempo máximo de espera por defecto. Las operaciones lentas por naturaleza
// (chat con IA, subida de archivos) piden un timeout mayor al llamar.
export const DEFAULT_TIMEOUT_MS = 15_000;
export const LONG_TIMEOUT_MS = 60_000;

export const NETWORK_ERROR_MESSAGE =
  "No se pudo conectar con el servidor. Revisa tu conexión a internet o intenta de nuevo en unos minutos.";
export const TIMEOUT_ERROR_MESSAGE = "El servidor tardó demasiado en responder. Intenta de nuevo.";
export const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró. Inicia sesión de nuevo.";

// El backend responde { error, details? }. En errores de validación (400),
// details es [{ field, message }]: se agregan al mensaje para que el
// usuario sepa qué campo corregir.
function buildErrorMessage(data, status) {
  if (!data || !data.error) {
    return status >= 500
      ? `El servidor tuvo un problema (${status}). Intenta de nuevo más tarde.`
      : `Error inesperado (${status})`;
  }
  if (Array.isArray(data.details) && data.details.length > 0) {
    const fields = data.details.map((d) => `${String(d.field).split(".").pop()}: ${d.message}`).join("; ");
    return `${data.error} — ${fields}`;
  }
  return data.error;
}

async function request(path, { method = "GET", body, isFormData = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const { token } = getState();
  const headers = {};
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response;
  let data;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const contentType = response.headers.get("content-type") || "";
    data = contentType.includes("application/json") ? await response.json() : null;
  } catch (err) {
    // Nunca se muestra el error crudo del navegador ("Failed to fetch",
    // "NetworkError when attempting...", "The user aborted a request").
    throw new Error(err && err.name === "AbortError" ? TIMEOUT_ERROR_MESSAGE : NETWORK_ERROR_MESSAGE, { cause: err });
  } finally {
    clearTimeout(timer);
  }

  // Solo es "sesión expirada" si se envió un token. Un 401 sin token es,
  // por ejemplo, un login con credenciales incorrectas: se muestra tal cual.
  if (response.status === 401 && token) {
    clearAuth();
    window.location.hash = "/login";
    throw new Error(SESSION_EXPIRED_MESSAGE);
  }

  if (!response.ok) {
    throw new Error(buildErrorMessage(data, response.status));
  }

  return data;
}

export const http = {
  get: (path, options) => request(path, options),
  post: (path, body, options) => request(path, { ...options, method: "POST", body }),
  patch: (path, body, options) => request(path, { ...options, method: "PATCH", body }),
  delete: (path, options) => request(path, { ...options, method: "DELETE" }),
  postForm: (path, formData, options) =>
    request(path, { ...options, method: "POST", body: formData, isFormData: true }),
};

/** Agrega parámetros de query omitiendo los vacíos: withQuery("/x", { cursor: null, limit: 50 }) → "/x?limit=50". */
export function withQuery(path, params = {}) {
  const query = new URLSearchParams(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== "")
  ).toString();
  return query ? `${path}?${query}` : path;
}

import { getState, clearAuth } from "../state/store.js";
import { getRouteSignal } from "../router.js";
import { backoffDelay } from "../utils/backoff.js";
import { isOfflineCacheable, readOfflineResponse, saveOfflineResponse } from "../offline/offlineStore.js";
import { reportNetworkOk, reportOfflineData, setOnline } from "../offline/connectivity.js";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Tiempo máximo de espera por defecto. Las operaciones lentas por naturaleza
// (chat con IA, subida de archivos) piden un timeout mayor al llamar.
export const DEFAULT_TIMEOUT_MS = 15_000;
export const LONG_TIMEOUT_MS = 60_000;

/**
 * Reintentos: SOLO para GET, que es idempotente (repetirlo no cambia nada en
 * el servidor). Un POST/PATCH/DELETE reintentado podría, por ejemplo, subir
 * dos veces un documento si la primera respuesta se perdió en la red.
 * Se reintenta ante errores de red y 502/503/504/429, con backoff
 * exponencial + jitter (utils/backoff.js); un 429 respeta Retry-After.
 */
export const MAX_GET_RETRIES = 2;
const RETRY_BACKOFF = { base: 500, max: 4000 };
const RETRYABLE_STATUS = new Set([429, 502, 503, 504]);

export const NETWORK_ERROR_MESSAGE =
  "No se pudo conectar con el servidor. Revisa tu conexión a internet o intenta de nuevo en unos minutos.";
export const TIMEOUT_ERROR_MESSAGE = "El servidor tardó demasiado en responder. Intenta de nuevo.";
export const SESSION_EXPIRED_MESSAGE = "Tu sesión expiró. Inicia sesión de nuevo.";
export const OFFLINE_WRITE_ERROR = "Sin conexión: esta acción necesita internet. No se guardó ningún cambio.";

/** Error de red/HTTP con su tipo: "network" | "timeout" | "http" | "offline". */
export class HttpError extends Error {
  constructor(message, { kind, status, cause } = {}) {
    super(message, { cause });
    this.name = "HttpError";
    this.kind = kind;
    this.status = status;
  }
}

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

const abortError = () => new DOMException("La petición se canceló al cambiar de vista.", "AbortError");

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(abortError());
      },
      { once: true }
    );
  });
}

/** Un intento de fetch con timeout propio y, opcionalmente, una señal externa (cambio de vista). */
async function fetchOnce(url, init, timeoutMs, externalSignal) {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), timeoutMs);
  const signal = externalSignal ? AbortSignal.any([timeout.signal, externalSignal]) : timeout.signal;
  try {
    const response = await fetch(url, { ...init, signal });
    const contentType = response.headers.get("content-type") || "";
    const data = contentType.includes("application/json") ? await response.json() : null;
    return { response, data };
  } catch (err) {
    if (externalSignal?.aborted) throw abortError();
    // Nunca se muestra el error crudo del navegador ("Failed to fetch",
    // "NetworkError when attempting...", "The user aborted a request").
    if (timeout.signal.aborted) throw new HttpError(TIMEOUT_ERROR_MESSAGE, { kind: "timeout", cause: err });
    throw new HttpError(NETWORK_ERROR_MESSAGE, { kind: "network", cause: err });
  } finally {
    clearTimeout(timer);
  }
}

async function request(
  path,
  { method = "GET", body, isFormData = false, timeoutMs = DEFAULT_TIMEOUT_MS, signal, retries } = {}
) {
  const isGet = method === "GET";
  // Sin conexión, las escrituras se rechazan de inmediato (no se encolan).
  if (!isGet && typeof navigator !== "undefined" && navigator.onLine === false) {
    throw new HttpError(OFFLINE_WRITE_ERROR, { kind: "offline" });
  }

  const { token, user } = getState();
  const headers = {};
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const init = { method, headers, body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined };

  // Los GET de una vista se cancelan si el usuario navega a otra: su
  // resultado ya no se mostraría. Las escrituras no se cancelan a medias.
  const cancelSignal = signal ?? (isGet ? getRouteSignal() : undefined);
  const maxRetries = retries ?? (isGet ? MAX_GET_RETRIES : 0);

  for (let attempt = 0; ; attempt++) {
    let result;
    try {
      result = await fetchOnce(`${BASE_URL}${path}`, init, timeoutMs, cancelSignal);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      if (err.kind === "network" && attempt < maxRetries) {
        await sleep(backoffDelay(attempt, RETRY_BACKOFF), cancelSignal);
        continue;
      }
      // Sin red: si es una lectura guardable y hay copia vigente, se usa.
      if (isGet && isOfflineCacheable(path)) {
        const cached = await readOfflineResponse(user?.id, path).catch(() => null);
        if (cached) {
          reportOfflineData(cached.savedAt);
          return cached.data;
        }
      }
      if (err.kind === "network") setOnline(false);
      throw err;
    }

    const { response, data } = result;
    if (isGet && RETRYABLE_STATUS.has(response.status) && attempt < maxRetries) {
      const retryAfter = Number(response.headers.get("retry-after"));
      const wait = retryAfter > 0 && retryAfter <= 10 ? retryAfter * 1000 : backoffDelay(attempt, RETRY_BACKOFF);
      await sleep(wait, cancelSignal);
      continue;
    }
    reportNetworkOk();

    // Solo es "sesión expirada" si se envió un token. Un 401 sin token es,
    // por ejemplo, un login con credenciales incorrectas: se muestra tal cual.
    if (response.status === 401 && token) {
      clearAuth();
      window.location.hash = "/login";
      throw new HttpError(SESSION_EXPIRED_MESSAGE, { kind: "http", status: 401 });
    }

    if (!response.ok) {
      throw new HttpError(buildErrorMessage(data, response.status), { kind: "http", status: response.status });
    }

    if (isGet && isOfflineCacheable(path) && user?.id) {
      saveOfflineResponse(user.id, path, data).catch(() => {});
    }
    return data;
  }
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

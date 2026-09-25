import { getState, clearAuth } from "../state/store.js";

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// El backend responde { error, details? }. En errores de validación (400),
// details es [{ field, message }]: se agregan al mensaje para que el
// usuario sepa qué campo corregir.
function buildErrorMessage(data, status) {
  const base = (data && data.error) || `Error inesperado (${status})`;
  if (data && Array.isArray(data.details) && data.details.length > 0) {
    const fields = data.details.map((d) => `${String(d.field).split(".").pop()}: ${d.message}`).join("; ");
    return `${base} — ${fields}`;
  }
  return base;
}

async function request(path, { method = "GET", body, isFormData = false } = {}) {
  const { token } = getState();
  const headers = {};
  if (!isFormData) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: isFormData ? body : body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401) {
    clearAuth();
    window.location.hash = "/login";
    throw new Error("Tu sesión expiró. Inicia sesión de nuevo.");
  }

  const contentType = response.headers.get("content-type") || "";
  const data = contentType.includes("application/json") ? await response.json() : null;

  if (!response.ok) {
    throw new Error(buildErrorMessage(data, response.status));
  }

  return data;
}

export const http = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: "POST", body }),
  patch: (path, body) => request(path, { method: "PATCH", body }),
  delete: (path) => request(path, { method: "DELETE" }),
  postForm: (path, formData) => request(path, { method: "POST", body: formData, isFormData: true }),
};

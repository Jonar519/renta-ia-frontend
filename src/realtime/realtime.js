import { backoffDelay } from "./backoff.js";

/**
 * Cliente WebSocket de notificaciones (API: /ws).
 *
 * - Se autentica con el primer mensaje ({ type: "auth", token }), no en la URL.
 * - Si la conexión cae, reintenta con backoff exponencial + jitter.
 * - Las vistas se suscriben a eventos con onDocumentUpdate() y pueden
 *   consultar/escuchar el estado ("connecting" | "open" | "closed") para
 *   activar el polling de respaldo mientras el socket no está disponible.
 */

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

export function toWebSocketUrl(apiUrl) {
  const url = new URL(apiUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/ws";
  url.search = "";
  return url.toString();
}

const documentListeners = new Set();
const statusListeners = new Set();
let socket = null;
let status = "closed";
let attempt = 0;
let reconnectTimer = null;
let getToken = () => null;
let stopped = true;

function setStatus(next) {
  if (next === status) return;
  status = next;
  statusListeners.forEach((fn) => fn(status));
}

function scheduleReconnect() {
  if (stopped || reconnectTimer) return;
  const delay = backoffDelay(attempt++);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  const token = getToken();
  if (stopped || !token) return;
  setStatus("connecting");

  const ws = new WebSocket(toWebSocketUrl(API_URL));
  socket = ws;

  ws.addEventListener("open", () => ws.send(JSON.stringify({ type: "auth", token })));
  ws.addEventListener("message", (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (message.type === "ready") {
      attempt = 0;
      setStatus("open");
    } else if (message.type === "document.updated") {
      documentListeners.forEach((fn) => fn(message));
    }
  });
  ws.addEventListener("close", () => {
    if (socket === ws) socket = null;
    setStatus("closed");
    // Token vencido o inválido (4401/4409): se reintenta igual; si el token
    // de la sesión ya no sirve, la API REST cerrará la sesión con un 401.
    scheduleReconnect();
  });
}

/** Inicia la conexión (tras iniciar sesión). */
export function startRealtime(tokenProvider) {
  getToken = tokenProvider;
  if (!stopped) return;
  stopped = false;
  attempt = 0;
  connect();
}

/** Cierra la conexión y deja de reintentar (al cerrar sesión). */
export function stopRealtime() {
  stopped = true;
  clearTimeout(reconnectTimer);
  reconnectTimer = null;
  if (socket) socket.close(1000, "logout");
  socket = null;
  setStatus("closed");
}

export function getRealtimeStatus() {
  return status;
}

export function onRealtimeStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

export function onDocumentUpdate(fn) {
  documentListeners.add(fn);
  return () => documentListeners.delete(fn);
}

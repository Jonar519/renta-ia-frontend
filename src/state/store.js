/**
 * Estado de la sesión (renta-ia-backend/docs/adr/0007-esquema-de-sesion.md).
 *
 *  - El access token (JWT de 15 min) vive SOLO en memoria: nunca en
 *    localStorage/sessionStorage, donde un XSS podría leerlo y llevárselo.
 *    Al recargar la página se pierde y se recupera con el refresh token
 *    (cookie httpOnly que JavaScript no puede leer; ver auth/session.js).
 *  - En localStorage solo queda una "pista" NO secreta ({ id, name, role }):
 *    sirve para saber si vale la pena intentar recuperar la sesión al abrir
 *    la app y, sin conexión, para leer la caché offline de ESE usuario. Con
 *    ella no se puede llamar a la API.
 */
const listeners = new Set();

const HINT_KEY = "renta_ia_session";
// Claves del esquema anterior (JWT de 1 día en localStorage): se borran.
const LEGACY_KEYS = ["renta_ia_token", "renta_ia_user"];

function readHint() {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    const hint = JSON.parse(localStorage.getItem(HINT_KEY) || "null");
    return hint && typeof hint.id === "string" ? hint : null;
  } catch {
    return null;
  }
}

function writeHint(user) {
  try {
    if (user) localStorage.setItem(HINT_KEY, JSON.stringify({ id: user.id, name: user.name, role: user.role }));
    else localStorage.removeItem(HINT_KEY);
  } catch {
    // Almacenamiento bloqueado: la sesión sigue funcionando, solo no se recuerda.
  }
}

const state = {
  token: null,
  // Usuario de la pista mientras se recupera la sesión (o sin conexión).
  user: readHint(),
};

export function getState() {
  return state;
}

/** ¿Hay (o puede haber) una sesión? Hay token, o una pista de un usuario anterior. */
export function hasSession() {
  return Boolean(state.token || state.user);
}

export function setAuth(token, user) {
  state.token = token;
  state.user = user;
  writeHint(user);
  notify();
}

/** Refresh silencioso (mismo usuario): actualiza token y datos sin volver a pintar las vistas. */
export function setAccessToken(token, user = state.user) {
  state.token = token;
  state.user = user;
  writeHint(user);
}

export function clearAuth() {
  state.token = null;
  state.user = null;
  writeHint(null);
  notify();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

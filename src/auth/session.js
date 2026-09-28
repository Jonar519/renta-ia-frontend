import { clearAuth, getState, setAccessToken, setAuth } from "../state/store.js";

/**
 * Ciclo de vida de la sesión en el navegador (renta-ia-backend/docs/adr/0007-esquema-de-sesion.md):
 *
 *  - restoreSession(): al abrir la app, pide un access token nuevo con la
 *    cookie de refresh (httpOnly). Sin conexión se conserva la pista del
 *    usuario para mostrar la caché offline.
 *  - refreshSession(): renovación "single-flight": si varias peticiones
 *    reciben 401 a la vez, se hace UN solo /refresh y todas esperan su
 *    resultado (cada /refresh rota la cookie; dos en paralelo desde la misma
 *    pestaña harían que el segundo pareciera una reutilización).
 *  - Renovación proactiva un minuto antes de que venza el access token.
 *  - logout(): revoca la sesión en el servidor y avisa a las demás pestañas.
 *
 * Usa fetch directamente (no api/http.js) para no crear un ciclo: http.js
 * llama a refreshSession() cuando recibe un 401.
 */

const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";

// Encabezado anti-CSRF que exige la API en /refresh y /logout.
export const CSRF_HEADERS = { "X-Requested-With": "renta-ia" };

const REFRESH_MARGIN_MS = 60_000;
// 409 = otra pestaña rotó la cookie en ese mismo instante; la nueva ya está
// en el navegador, así que basta con reintentar una vez.
const RACE_RETRY_DELAY_MS = 300;

let inFlight = null;
let proactiveTimer = null;

const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("renta-ia-session") : null;
channel?.addEventListener("message", (event) => {
  // Otra pestaña cerró sesión: esta también (su cookie ya no existe).
  if (event.data === "logout" && getState().user) endLocalSession();
});

async function callAuth(path) {
  return fetch(`${BASE_URL}/api/auth/${path}`, {
    method: "POST",
    credentials: "include",
    headers: CSRF_HEADERS,
  });
}

/** Segundos de epoch en que vence el JWT (sin verificar: eso lo hace la API). */
export function tokenExpiry(token) {
  try {
    const payload = JSON.parse(atob(token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function scheduleProactiveRefresh(token) {
  clearTimeout(proactiveTimer);
  const expiresAt = tokenExpiry(token);
  if (!expiresAt) return;
  const delay = Math.max(expiresAt - Date.now() - REFRESH_MARGIN_MS, 5_000);
  proactiveTimer = setTimeout(() => {
    // Con la pestaña oculta no se renueva: se hará al volver o ante un 401.
    if (typeof document !== "undefined" && document.hidden) return;
    refreshSession().catch(() => {});
  }, delay);
}

/** Guarda una sesión recién iniciada (login/registro) o recuperada. */
export function startSession({ accessToken, user }) {
  setAuth(accessToken, user);
  scheduleProactiveRefresh(accessToken);
}

function endLocalSession() {
  clearTimeout(proactiveTimer);
  clearAuth();
  if (typeof window !== "undefined" && window.location.hash !== "#/login") window.location.hash = "/login";
}

/**
 * Pide un access token nuevo. Resuelve con el token, o con null si la sesión
 * ya no es válida (y en ese caso cierra la sesión local). Lanza solo ante
 * errores de red, para que quien llama pueda distinguir "sin conexión".
 */
export function refreshSession() {
  inFlight ??= (async () => {
    try {
      let response = await callAuth("refresh");
      if (response.status === 409) {
        await new Promise((resolve) => setTimeout(resolve, RACE_RETRY_DELAY_MS));
        response = await callAuth("refresh");
      }
      if (!response.ok) {
        endLocalSession();
        return null;
      }
      const { accessToken, user } = await response.json();
      const previous = getState().user;
      // Mismo usuario: se renueva en silencio. Si cambió (otra pestaña inició
      // sesión con otra cuenta), se notifica para que todo se vuelva a pintar.
      if (previous && previous.id === user.id) setAccessToken(accessToken, user);
      else setAuth(accessToken, user);
      scheduleProactiveRefresh(accessToken);
      return accessToken;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * Al abrir la app: recupera la sesión si hay pista de una. No bloquea la
 * primera pintura: las peticiones que salgan antes esperan este mismo
 * refresh (api/http.js), así que no hay 401 de más.
 */
export async function restoreSession() {
  if (!getState().user || getState().token) return;
  try {
    const token = await refreshSession();
    // Se notifica para que se conecte el tiempo real, etc.
    if (token) setAuth(token, getState().user);
  } catch {
    // Sin conexión: se mantiene la pista para la caché offline; las
    // peticiones reintentarán el refresh cuando vuelva la red.
  }
}

/** Renueva al volver a la pestaña si el token vence pronto (los timers se congelan en segundo plano). */
if (typeof document !== "undefined") {
  document.addEventListener("visibilitychange", () => {
    const { token } = getState();
    if (document.hidden || !token) return;
    const expiresAt = tokenExpiry(token);
    if (expiresAt && expiresAt - Date.now() < REFRESH_MARGIN_MS) refreshSession().catch(() => {});
  });
}

export async function logout() {
  try {
    await callAuth("logout");
  } catch {
    // Sin conexión la cookie sigue en el navegador hasta que venza; la sesión
    // local se cierra igual.
  }
  channel?.postMessage("logout");
  endLocalSession();
}

/**
 * Estado de conectividad de la app:
 *  - online/offline según el navegador (eventos "online"/"offline") y según
 *    los errores de red reales de http.js (navigator.onLine puede decir
 *    "online" con el Wi-Fi conectado pero sin internet).
 *  - staleSince: fecha de los datos guardados más viejos que se están
 *    mostrando porque no hubo red.
 */

const listeners = new Set();
const state = {
  online: typeof navigator === "undefined" ? true : navigator.onLine,
  staleSince: null,
};

function notify() {
  listeners.forEach((fn) => fn({ ...state }));
}

export function getConnectivity() {
  return { ...state };
}

export function onConnectivityChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function setOnline(online) {
  if (state.online === online) return;
  state.online = online;
  if (online) state.staleSince = null;
  notify();
}

/** Se mostraron datos guardados (IndexedDB) con fecha `savedAt`. */
export function reportOfflineData(savedAt) {
  state.online = false;
  state.staleSince = state.staleSince ? Math.min(state.staleSince, savedAt) : savedAt;
  notify();
}

/** Una petición a la red funcionó: los datos en pantalla vuelven a estar al día. */
export function reportNetworkOk() {
  if (state.online && state.staleSince === null) return;
  state.online = true;
  state.staleSince = null;
  notify();
}

if (typeof window !== "undefined") {
  window.addEventListener("online", () => setOnline(true));
  window.addEventListener("offline", () => setOnline(false));
}

const relative = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

/** "hace 5 minutos", "hace 2 horas"… */
export function formatAge(savedAt, now = Date.now()) {
  const minutes = Math.round((now - savedAt) / 60000);
  if (minutes < 1) return "hace menos de un minuto";
  if (minutes < 60) return relative.format(-Math.max(minutes, 0), "minute");
  const hours = Math.round(minutes / 60);
  if (hours < 24) return relative.format(-hours, "hour");
  return relative.format(-Math.round(hours / 24), "day");
}

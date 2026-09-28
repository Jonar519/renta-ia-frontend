/**
 * Caché offline de SOLO LECTURA en IndexedDB (política: docs/cache-policy.md).
 *
 * Qué guarda: únicamente respuestas GET de la lista de clientes, el detalle
 * de un cliente (nombre, documento) y los listados de documentos ya vistos.
 * NUNCA conceptos tributarios con montos, resúmenes, alertas ni el chat.
 *
 * Seguridad:
 *  - Una base de datos por usuario ("renta-ia-offline-<userId>"): los datos
 *    de un contador nunca se mezclan con los de otro en el mismo equipo.
 *  - Se BORRA al cerrar sesión y al iniciar sesión con otro usuario.
 *  - Cada entrada caduca a las 24 h (TTL).
 *  - El Service Worker sigue sin guardar respuestas de la API: esta caché
 *    la controla la app, sabe de quién es cada dato y la vacía al salir.
 */

const DB_PREFIX = "renta-ia-offline-";
const STORE = "responses";
export const OFFLINE_TTL_MS = 24 * 60 * 60 * 1000;
const KNOWN_DBS_KEY = "renta-ia-offline-dbs";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
/** Rutas GET que se pueden guardar para consultar sin conexión. */
export const OFFLINE_ROUTES = [
  new RegExp("^/api/clients(\\?.*)?$"),
  new RegExp(`^/api/clients/${UUID}$`),
  new RegExp(`^/api/documents/client/${UUID}(\\?.*)?$`),
];

export const isOfflineCacheable = (path) => OFFLINE_ROUTES.some((regex) => regex.test(path));

const hasIndexedDB = () => typeof indexedDB !== "undefined";
const dbName = (userId) => `${DB_PREFIX}${userId}`;

function rememberDb(name) {
  try {
    const known = new Set(JSON.parse(localStorage.getItem(KNOWN_DBS_KEY) || "[]"));
    known.add(name);
    localStorage.setItem(KNOWN_DBS_KEY, JSON.stringify([...known]));
  } catch {
    /* sin localStorage: se usa indexedDB.databases() al borrar */
  }
}

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function openDb(userId) {
  const name = dbName(userId);
  rememberDb(name);
  const request = indexedDB.open(name, 1);
  request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "key" });
  return promisify(request);
}

async function withStore(userId, mode, fn) {
  const db = await openDb(userId);
  try {
    const store = db.transaction(STORE, mode).objectStore(STORE);
    return await promisify(fn(store));
  } finally {
    db.close();
  }
}

export async function saveOfflineResponse(userId, key, data, now = Date.now()) {
  if (!hasIndexedDB() || !userId) return;
  await withStore(userId, "readwrite", (store) => store.put({ key, data, savedAt: now }));
}

/** { data, savedAt } si hay una entrada vigente; null si no hay o caducó. */
export async function readOfflineResponse(userId, key, now = Date.now()) {
  if (!hasIndexedDB() || !userId) return null;
  const entry = await withStore(userId, "readonly", (store) => store.get(key));
  if (!entry) return null;
  if (now - entry.savedAt > OFFLINE_TTL_MS) {
    await withStore(userId, "readwrite", (store) => store.delete(key));
    return null;
  }
  return entry;
}

/** Borra las bases offline de todos los usuarios, salvo `keepUserId`. */
export async function clearOfflineData({ keepUserId } = {}) {
  if (!hasIndexedDB()) return;
  const names = new Set();
  try {
    JSON.parse(localStorage.getItem(KNOWN_DBS_KEY) || "[]").forEach((n) => names.add(n));
  } catch {
    /* ignorar */
  }
  if (typeof indexedDB.databases === "function") {
    (await indexedDB.databases()).forEach((db) => db.name?.startsWith(DB_PREFIX) && names.add(db.name));
  }
  const keep = keepUserId ? dbName(keepUserId) : null;
  await Promise.all(
    [...names]
      .filter((name) => name !== keep)
      .map(
        (name) =>
          new Promise((resolve) => {
            const request = indexedDB.deleteDatabase(name);
            request.onsuccess = request.onerror = request.onblocked = () => resolve();
          })
      )
  );
  try {
    localStorage.setItem(KNOWN_DBS_KEY, JSON.stringify(keep && names.has(keep) ? [keep] : []));
  } catch {
    /* ignorar */
  }
}

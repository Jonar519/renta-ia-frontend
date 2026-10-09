import { http } from "./http.js";
import { getState } from "../state/store.js";
import { refreshSession } from "../auth/session.js";

/**
 * Foto de perfil (B12). La imagen exige sesión y un <img src> no puede
 * mandar el token (vive solo en memoria): se pide con fetch y se muestra
 * como blob: (la CSP lo permite en img-src). Se guarda una sola copia, la de
 * la versión actual (avatarUpdatedAt): al cambiar la foto se pide la nueva y
 * se libera la anterior.
 */
const BASE_URL = import.meta.env.VITE_API_URL || "http://localhost:4000";
let cached = null; // { version, url: Promise<string | null> }

async function download(retry = true) {
  const response = await fetch(`${BASE_URL}/api/users/me/avatar`, {
    headers: { Authorization: `Bearer ${getState().token}` },
  });
  if (response.status === 401 && retry && (await refreshSession().catch(() => null))) return download(false);
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

/** URL blob: de la foto actual, o null si no hay (o no se pudo traer). */
export function avatarUrl(version) {
  if (!version) return Promise.resolve(null);
  if (cached?.version !== version) {
    cached?.url.then((url) => url && URL.revokeObjectURL(url));
    cached = { version, url: download().catch(() => null) };
  }
  return cached.url;
}

export const avatarApi = {
  /** blob: la imagen ya recortada y reducida en el navegador (JPEG 256×256). */
  upload(blob) {
    const form = new FormData();
    form.append("avatar", blob, "avatar.jpg");
    return http.postForm("/api/users/me/avatar", form);
  },
  remove: () => http.delete("/api/users/me/avatar"),
};

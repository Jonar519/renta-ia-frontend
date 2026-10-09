import { http } from "../api/http.js";
import { getState, setAuth, subscribe } from "../state/store.js";
import { showErrorToast } from "./toast.js";

/**
 * Densidad de las tablas (B15): Cómoda o Compacta. Es una preferencia de
 * trabajo de la cuenta (se guarda en el backend y la sigue en cualquier
 * equipo), a diferencia del tema, que es del entorno y lo decide el sistema
 * operativo. Vale para TODAS las tablas: el selector está encima de Clientes,
 * Documentos y Usuarios; cambiarlo en una cambia todas.
 *
 * Se aplica con data-density en <html>; el CSS ajusta el espaciado de .table.
 * Guarda con http.js (ya está en el chunk de entrada) y no con users.api.js:
 * Clientes es la pantalla de llegada y su primera carga tiene tope estricto (22 KB).
 */
export const currentDensity = () => (getState().user?.tableDensity === "compact" ? "compact" : "comfortable");

export function applyDensity() {
  document.documentElement.dataset.density = currentDensity();
}

let instances = 0;
// Solo el último cambio puede volver atrás: si el primero de dos cambios
// rápidos falla después de que el segundo se guardó, no pisa al segundo.
let latest = 0;

/** Selector (dos radios en un fieldset): accesible con teclado y lector de pantalla. */
export function densityToggleHtml() {
  const name = `density-${++instances}`;
  const option = (value, label) =>
    `<label class="density__option"><input type="radio" name="${name}" value="${value}"${currentDensity() === value ? " checked" : ""} /> ${label}</label>`;
  return `<fieldset class="density"><legend class="density__legend">Densidad de la tabla</legend>${option("comfortable", "Cómoda")}${option("compact", "Compacta")}</fieldset>`;
}

function show(value) {
  const { token, user } = getState();
  if (user) setAuth(token, { ...user, tableDensity: value });
  applyDensity();
  for (const input of document.querySelectorAll(".density input")) input.checked = input.value === value;
}

// La pantalla se pinta con la pista local de la sesión y el usuario real llega
// después (al recuperar la sesión del servidor): selectores y página siguen
// cada cambio del usuario de la sesión, no solo el valor del momento de pintar.
let subscribed = false;
function syncWithSession() {
  applyDensity();
  const value = currentDensity();
  for (const input of document.querySelectorAll(".density input")) input.checked = input.value === value;
}

/** Aplica la preferencia y enlaza los selectores dentro de `root`. Guarda en el backend; si falla, vuelve atrás. */
export function bindDensityToggles(root) {
  if (!subscribed) {
    subscribe(syncWithSession);
    subscribed = true;
  }
  syncWithSession();
  for (const fieldset of root.querySelectorAll(".density")) {
    fieldset.addEventListener("change", async (event) => {
      const value = event.target.value;
      const previous = currentDensity();
      if (value === previous) return;
      const mine = ++latest;
      show(value);
      try {
        await http.patch("/api/users/me", { tableDensity: value });
      } catch (err) {
        if (mine !== latest) return;
        show(previous);
        showErrorToast(err);
      }
    });
  }
}

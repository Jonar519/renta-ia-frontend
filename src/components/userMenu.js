import { getState, subscribe } from "../state/store.js";
import { logout } from "../auth/session.js";
import { ROLE_LABELS } from "../auth/roles.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { showToast } from "./toast.js";

/**
 * Menú de usuario único, el mismo en todas las pantallas con sesión (va en
 * el sidebar). Patrón "menu button" de WAI-ARIA:
 *  - Abrir (clic, Enter, Espacio o ↓) lleva el foco a la primera opción; ↑ abre en la última.
 *  - ↑/↓ recorren las opciones (con vuelta), Inicio/Fin van a la primera/última.
 *  - Escape cierra y devuelve el foco al botón que lo abrió.
 *  - Tab cierra (el foco sigue su orden normal); un clic fuera también cierra.
 */

const initials = (name = "") =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0].toUpperCase())
    .join("") || "?";

// Nombre, rol y correo. El correo no está en la pista de localStorage: llega
// al recuperar la sesión, por eso la cabecera se vuelve a pintar al abrir.
function headerHtml(user) {
  const email = user?.email;
  return `<p class="user-menu__header-name">${escapeHtml(user?.name ?? "")}</p>
    <p class="user-menu__header-role">${escapeHtml(ROLE_LABELS[user?.role] ?? "")}</p>
    ${email ? `<p class="user-menu__header-email">${escapeHtml(email)}</p>` : ""}`;
}

export function userMenuHtml(user = getState().user) {
  const name = user?.name ?? "";
  const role = ROLE_LABELS[user?.role] ?? "";
  return `
    <div class="user-menu" data-user-menu>
      <button type="button" class="user-menu__button" id="user-menu-button" aria-haspopup="menu" aria-expanded="false" aria-controls="user-menu-list">
        <span class="user-menu__avatar" aria-hidden="true">${escapeHtml(initials(name))}</span>
        <span class="user-menu__who">
          <span class="user-menu__name">${escapeHtml(name)}</span>
          <span class="user-menu__role">${escapeHtml(role)}</span>
        </span>
        <span class="visually-hidden">: menú de la cuenta</span>
      </button>
      <div class="user-menu__popup" hidden>
        <div class="user-menu__header">${headerHtml(user)}</div>
        <ul class="user-menu__list" id="user-menu-list" role="menu" aria-labelledby="user-menu-button">
          <li role="none"><a role="menuitem" tabindex="-1" class="user-menu__item" href="#/profile">Mi perfil</a></li>
          <li role="none"><a role="menuitem" tabindex="-1" class="user-menu__item" href="#/seguridad">Seguridad</a></li>
          <li role="none"><button role="menuitem" tabindex="-1" type="button" class="user-menu__item" data-action="logout">Salir</button></li>
        </ul>
      </div>
    </div>`;
}

export function bindUserMenu(root) {
  const menu = root.querySelector("[data-user-menu]");
  if (!menu) return () => {};
  const button = menu.querySelector(".user-menu__button");
  const popup = menu.querySelector(".user-menu__popup");
  const items = [...menu.querySelectorAll('[role="menuitem"]')];
  const isOpen = () => !popup.hidden;

  // Si cambia el nombre (Mi perfil) o la sesión se renueva, el botón se
  // actualiza sin volver a pintar la pantalla. Al salir de esta pantalla (el
  // menú ya no está en el documento), la suscripción se borra sola.
  const unsubscribe = subscribe((state) => {
    if (!menu.isConnected) return unsubscribe();
    if (!state.user) return;
    menu.querySelector(".user-menu__avatar").textContent = initials(state.user.name);
    menu.querySelector(".user-menu__name").textContent = state.user.name ?? "";
    menu.querySelector(".user-menu__role").textContent = ROLE_LABELS[state.user.role] ?? "";
  });

  function focusItem(index) {
    items[(index + items.length) % items.length].focus();
  }

  function open(focusIndex = 0) {
    menu.querySelector(".user-menu__header").innerHTML = headerHtml(getState().user);
    popup.hidden = false;
    button.setAttribute("aria-expanded", "true");
    focusItem(focusIndex);
    document.addEventListener("pointerdown", onPointerDownOutside, true);
  }

  function close({ returnFocus = false } = {}) {
    if (!isOpen()) return;
    popup.hidden = true;
    button.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onPointerDownOutside, true);
    if (returnFocus) button.focus();
  }

  function onPointerDownOutside(event) {
    if (!menu.contains(event.target)) close();
  }

  button.addEventListener("click", () => (isOpen() ? close({ returnFocus: true }) : open(0)));
  button.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      open(0);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      open(items.length - 1);
    }
  });

  popup.addEventListener("keydown", (event) => {
    const index = items.indexOf(document.activeElement);
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        focusItem(index + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        focusItem(index - 1);
        break;
      case "Home":
        event.preventDefault();
        focusItem(0);
        break;
      case "End":
        event.preventDefault();
        focusItem(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        close({ returnFocus: true });
        break;
      case "Tab":
        close();
        break;
    }
  });

  // Por su función, no por su posición: los enlaces ("Mi perfil", "Seguridad")
  // navegan y cierran el menú; "Salir" cierra la sesión.
  for (const link of popup.querySelectorAll("a[role=menuitem]")) link.addEventListener("click", () => close());
  const logoutItem = popup.querySelector("[data-action=logout]");
  logoutItem.addEventListener("click", async () => {
    close();
    logoutItem.disabled = true;
    await logout();
    showToast("Cerraste sesión.", "success");
  });

  return () => document.removeEventListener("pointerdown", onPointerDownOutside, true);
}

import { usersApi } from "../api/users.api.js";
import { ROLE_LABELS } from "../auth/roles.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { paintAvatar } from "../components/userMenu.js";
import { avatarApi } from "../api/avatar.api.js";
import { bindRetry, errorStateHtml, setPending, skeletonBlockHtml } from "../components/states.js";
import { bindPasswordFields, passwordFieldHtml, PASSWORD_HINT } from "../components/passwordField.js";
import { showToast } from "../components/toast.js";
import { getState, setAuth } from "../state/store.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Mi perfil" (B11, B12): foto (se recorta en el navegador: components/avatarCropper.js); nombre y teléfono; correo (se confirma desde el correo
 * nuevo, con aviso al anterior); contraseña (pide la actual y cierra las
 * demás sesiones). Cada formulario pide de nuevo la contraseña cuando el
 * cambio es sensible; los motivos de rechazo de la API se muestran tal cual.
 */
const errorBox = (id) => `<p class="form-hint form-hint--error form-grid__wide" id="${id}" role="alert"></p>`;

/** Mensaje de la API, o el detalle por campo de un 400 de validación. */
const reason = (err) => (err.details?.length ? `${err.details.map((d) => d.message).join(". ")}.` : err.message);

function bindForm(form, pendingText, action) {
  const box = form.querySelector("[role=alert]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    box.textContent = "";
    const done = setPending(form.querySelector("button[type=submit]"), pendingText);
    try {
      await action(new FormData(form));
    } catch (err) {
      if (err.name === "AbortError") return;
      box.textContent = reason(err);
      form.querySelector("input:not([readonly])")?.focus();
    } finally {
      done();
    }
  });
}

/** El nombre y el correo también se ven en el menú de la cuenta: se actualizan en la sesión local. */
function syncSession(me) {
  const { token, user } = getState();
  if (user) setAuth(token, { ...user, name: me.name, email: me.email });
}

export async function renderProfile(root) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("profile")}
      <main class="main" id="main-content" tabindex="-1">
        <header class="main__header">
          <div>
            <h1 class="page-title">Mi perfil</h1>
            <p class="page-subtitle">Los datos de tu cuenta en Renta IA.</p>
          </div>
        </header>
        <div id="profile" aria-live="polite">${skeletonBlockHtml({ lines: 6 })}</div>
      </main>
    </div>
  `;
  bindSidebarEvents(root);
  const container = root.querySelector("#profile");

  async function load() {
    container.setAttribute("aria-busy", "true");
    try {
      show(await usersApi.me());
    } catch (err) {
      if (err.name === "AbortError") return;
      container.innerHTML = errorStateHtml(err.message, { title: "No se pudieron cargar tus datos." });
    } finally {
      container.removeAttribute("aria-busy");
    }
  }
  bindRetry(container, load);

  function show(me) {
    const pending = me.pendingEmail;
    container.innerHTML = `
      <section class="panel" aria-labelledby="profile-photo-title">
        <h2 id="profile-photo-title">Foto de perfil</h2>
        <div class="profile-photo">
          <span class="profile-photo__current user-menu__avatar" id="profile-photo" aria-hidden="true"></span>
          <div>
            <input type="file" id="avatar-file" accept="image/png,image/jpeg" hidden />
            <div class="form-actions profile-photo__actions">
              <button type="button" class="btn btn--ghost" id="avatar-choose">${me.avatarUpdatedAt ? "Cambiar foto" : "Elegir foto"}</button>
              ${me.avatarUpdatedAt ? `<button type="button" class="btn btn--ghost" id="avatar-remove">Quitar foto</button>` : ""}
            </div>
            <p class="form-hint">PNG o JPG. La encuadras aquí y se guarda a 256×256, sin los datos del archivo original (como la ubicación).</p>
            <p class="form-hint form-hint--error" id="avatar-error" role="alert"></p>
          </div>
        </div>
        <div id="avatar-cropper"></div>
      </section>

      <section class="panel" aria-labelledby="profile-data-title">
        <h2 id="profile-data-title">Datos de la cuenta</h2>
        <form id="profile-form" class="form-grid" novalidate>
          <label>Nombre completo
            <input name="name" required minlength="2" maxlength="150" autocomplete="name" value="${escapeHtml(me.name)}" />
          </label>
          <label>Teléfono (opcional)
            <input name="phone" type="tel" inputmode="tel" maxlength="30" autocomplete="tel" value="${escapeHtml(me.phone ?? "")}" />
          </label>
          <dl class="profile-data form-grid__wide">
            <dt>Rol</dt><dd>${escapeHtml(ROLE_LABELS[me.role] ?? me.role)}</dd>
          </dl>
          ${errorBox("profile-error")}
          <div class="form-actions"><button type="submit" class="btn btn--primary">Guardar</button></div>
        </form>
      </section>

      <section class="panel" aria-labelledby="profile-email-title">
        <h2 id="profile-email-title">Correo</h2>
        <div class="profile-email-status">
        <p>Inicias sesión con <strong id="profile-email">${escapeHtml(me.email)}</strong>.</p>
        ${
          pending
            ? `<p id="profile-pending">Esperando confirmación de <strong>${escapeHtml(pending.email)}</strong>: abre el enlace que te enviamos a ese correo (vence el <span class="num">${escapeHtml(new Date(pending.expiresAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" }))}</span>).
                <button type="button" class="btn btn--ghost btn--small" id="profile-cancel-email">Cancelar el cambio</button></p>`
            : ""
        }
        </div>
        <form id="email-form" class="form-grid" novalidate>
          <label>Correo nuevo
            <input name="newEmail" type="email" required maxlength="150" autocomplete="email" />
          </label>
          ${passwordFieldHtml({ id: "email-password", name: "password", label: "Contraseña actual", autocomplete: "current-password" })}
          <p class="form-hint form-grid__wide">Te enviaremos un enlace al correo nuevo y un aviso al actual. El correo cambia cuando abras ese enlace.</p>
          ${errorBox("email-error")}
          <div class="form-actions"><button type="submit" class="btn btn--primary">Enviar enlace</button></div>
        </form>
      </section>

      <section class="panel" aria-labelledby="profile-password-title">
        <h2 id="profile-password-title">Contraseña</h2>
        <form id="password-form" class="form-grid" novalidate>
          ${passwordFieldHtml({ id: "password-current", name: "currentPassword", label: "Contraseña actual", autocomplete: "current-password" })}
          <span></span>
          ${passwordFieldHtml({ id: "password-new", name: "newPassword", label: "Contraseña nueva", autocomplete: "new-password", minlength: 10, describedBy: "password-hint" })}
          ${passwordFieldHtml({ id: "password-confirm", name: "confirm", label: "Repite la contraseña nueva", autocomplete: "new-password", minlength: 10 })}
          <p class="form-hint form-grid__wide" id="password-hint">${PASSWORD_HINT} Al cambiarla se cerrarán tus otras sesiones.</p>
          ${errorBox("password-error")}
          <div class="form-actions"><button type="submit" class="btn btn--primary">Cambiar contraseña</button></div>
        </form>
      </section>`;
    bindPasswordFields(container);
    bindPhoto(me);

    bindForm(container.querySelector("#profile-form"), "Guardando…", async (data) => {
      const updated = await usersApi.update({ name: data.get("name").trim(), phone: data.get("phone").trim() });
      syncSession(updated);
      showToast("Guardamos tus datos.", "success");
    });

    bindForm(container.querySelector("#email-form"), "Enviando…", async (data) => {
      const { pendingEmail } = await usersApi.requestEmailChange(data.get("newEmail").trim(), data.get("password"));
      showToast(`Te enviamos un enlace a ${pendingEmail.email}. Tu correo no cambia hasta que lo abras.`, "success");
      await load();
    });

    container.querySelector("#profile-cancel-email")?.addEventListener("click", async (event) => {
      const done = setPending(event.currentTarget, "Cancelando…");
      try {
        await usersApi.cancelEmailChange();
        showToast("Cancelaste el cambio de correo.", "info");
        await load();
      } catch (err) {
        done();
        showToast(err.message, "error");
      }
    });

    const passwordForm = container.querySelector("#password-form");
    bindForm(passwordForm, "Cambiando…", async (data) => {
      if (data.get("newPassword") !== data.get("confirm")) {
        throw new Error("Las dos contraseñas nuevas no coinciden.");
      }
      const { closedSessions } = await usersApi.changePassword(data.get("currentPassword"), data.get("newPassword"));
      passwordForm.reset();
      const others = closedSessions === 1 ? "1 sesión más" : `${closedSessions} sesiones más`;
      showToast(
        closedSessions ? `Cambiaste tu contraseña y cerramos ${others}.` : "Cambiaste tu contraseña.",
        "success"
      );
    });
  }

  /** Foto: elegir → recortar (módulo diferido) → subir; o quitarla. */
  function bindPhoto(me) {
    paintAvatar(container.querySelector("#profile-photo"), { name: me.name, avatarUpdatedAt: me.avatarUpdatedAt });
    const input = container.querySelector("#avatar-file");
    const choose = container.querySelector("#avatar-choose");
    const errorBox = container.querySelector("#avatar-error");
    const setPhoto = (avatarUpdatedAt) => {
      const { token, user } = getState();
      if (user) setAuth(token, { ...user, avatarUpdatedAt }); // el menú de la cuenta también cambia
      return load();
    };

    choose.addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files[0];
      input.value = "";
      if (!file) return;
      errorBox.textContent = "";
      try {
        const { cropAvatar } = await import("../components/avatarCropper.js");
        const blob = await cropAvatar(container.querySelector("#avatar-cropper"), file);
        if (!blob) return choose.focus();
        const { avatarUpdatedAt } = await avatarApi.upload(blob);
        showToast("Guardamos tu foto.", "success");
        await setPhoto(avatarUpdatedAt);
      } catch (err) {
        errorBox.textContent = err.message;
        choose.focus();
      }
    });

    container.querySelector("#avatar-remove")?.addEventListener("click", async (event) => {
      const done = setPending(event.currentTarget, "Quitando…");
      try {
        await avatarApi.remove();
        showToast("Quitaste tu foto.", "info");
        await setPhoto(null);
      } catch (err) {
        done();
        errorBox.textContent = err.message;
      }
    });
  }

  await load();
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderProfile(root);

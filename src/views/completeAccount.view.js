import { authApi } from "../api/auth.api.js";
import { startSession } from "../auth/session.js";
import { ROLE_LABELS } from "../auth/roles.js";
import { showToast } from "../components/toast.js";
import { bindRetry, errorStateHtml, setPending, skeletonBlockHtml } from "../components/states.js";
import { bindPasswordFields, passwordFieldHtml } from "../components/passwordField.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Completa tu cuenta": la persona invitada abre el enlace del correo
 * (#/invitacion/<token>) y define SU contraseña. Pública (sin sesión).
 *
 *  - El token se quita de la barra de direcciones apenas se lee
 *    (history.replaceState): no queda en el historial ni en una captura de
 *    pantalla. Si se recarga la página, hay que volver a abrir el enlace.
 *  - El token se envía en el CUERPO de las peticiones, nunca en la URL.
 *  - Enlace inválido, vencido, reemplazado o ya usado: mismo mensaje (410).
 */
export const PASSWORD_HINT =
  "Mínimo 10 caracteres. Una frase de varias palabras es más segura que una clave corta con símbolos. No uses tu nombre ni tu correo.";

const INVALID_HTML = `
  <div class="state state--error" role="alert">
    <p class="state__title">Este enlace de invitación no es válido o ya venció.</p>
    <p class="state__message">Puede que ya hayas activado tu cuenta, que te hayan enviado uno más nuevo o que hayan pasado 72 horas. Pide a tu administrador un enlace nuevo.</p>
    <a class="btn btn--ghost btn--small" href="#/login">Ir a iniciar sesión</a>
  </div>`;

const NO_TOKEN_HTML = `
  <div class="state state--empty">
    <p class="state__title">Abre el enlace que recibiste por correo.</p>
    <p class="state__message">Por seguridad, el enlace se borra de la barra de direcciones apenas se usa. Si recargaste la página, vuelve a abrirlo desde el correo.</p>
  </div>`;

export function renderCompleteAccount(root, token) {
  root.innerHTML = `
    <main class="auth-screen" id="main-content" tabindex="-1">
      <div class="auth-card">
        <h1 class="auth-title">Completa tu cuenta</h1>
        <div id="invitation" aria-live="polite"></div>
      </div>
    </main>`;
  const container = root.querySelector("#invitation");

  if (!token) {
    container.innerHTML = NO_TOKEN_HTML;
    return;
  }
  // Fuera de la barra de direcciones (sin hashchange: no vuelve a resolver la ruta).
  history.replaceState(history.state, "", "#/invitacion");

  async function load() {
    container.innerHTML = skeletonBlockHtml({ lines: 4, label: "Verificando tu invitación…" });
    container.setAttribute("aria-busy", "true");
    try {
      showForm(await authApi.lookupInvitation(token));
    } catch (err) {
      container.innerHTML =
        err.status === 410 || err.status === 400
          ? INVALID_HTML
          : errorStateHtml(err.message, { title: "No se pudo verificar tu invitación." });
    } finally {
      container.removeAttribute("aria-busy");
    }
  }
  bindRetry(container, load);

  function showForm(invitation) {
    const until = new Date(invitation.expiresAt).toLocaleString("es-CO");
    container.innerHTML = `
      <p class="auth-subtitle">Hola, <strong>${escapeHtml(invitation.name)}</strong>. Te invitaron a Renta IA como
        <strong>${escapeHtml(ROLE_LABELS[invitation.role] ?? invitation.role)}</strong>. Define tu contraseña para activar tu cuenta.</p>
      <form id="complete-form" class="auth-form" novalidate>
        <div class="auth-field">
          <label for="complete-email">Correo</label>
          <input id="complete-email" type="email" name="username" value="${escapeHtml(invitation.email)}" autocomplete="username" readonly />
        </div>
        ${passwordFieldHtml({ id: "complete-password", name: "password", label: "Contraseña", autocomplete: "new-password", minlength: 10, describedBy: "password-hint" })}
        <p class="auth-hint" id="password-hint">${PASSWORD_HINT}</p>
        ${passwordFieldHtml({ id: "complete-confirm", name: "confirm", label: "Repite la contraseña", autocomplete: "new-password", minlength: 10 })}
        <p class="form-hint form-hint--error" id="complete-error" role="alert"></p>
        <button type="submit" class="btn btn--primary btn--block">Activar mi cuenta</button>
      </form>
      <p class="auth-hint auth-hint--after">El enlace vence el <span class="num">${escapeHtml(until)}</span> y sirve una sola vez.</p>`;

    const form = container.querySelector("#complete-form");
    const errorBox = container.querySelector("#complete-error");
    bindPasswordFields(container);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const password = form.elements.password.value;
      errorBox.textContent = "";
      if (password.length < 10) {
        errorBox.textContent = "La contraseña debe tener al menos 10 caracteres.";
        form.elements.password.focus();
        return;
      }
      if (password !== form.elements.confirm.value) {
        errorBox.textContent = "Las dos contraseñas no coinciden.";
        form.elements.confirm.focus();
        return;
      }
      const done = setPending(form.querySelector("button[type=submit]"), "Activando…");
      try {
        const session = await authApi.acceptInvitation(token, password);
        startSession(session);
        showToast(`Tu cuenta está activa. Te damos la bienvenida, ${session.user.name}.`, "success");
        window.location.hash = "/";
      } catch (err) {
        done();
        if (err.status === 410) {
          container.innerHTML = INVALID_HTML;
          return;
        }
        // 400: la política de contraseñas (detalles de la API) u otro error.
        const details = err.details?.map((d) => d.message).join(". ");
        errorBox.textContent = details ? `${details}.` : err.message;
        form.elements.password.focus();
      }
    });
  }

  return load();
}

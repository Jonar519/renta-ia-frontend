import { authApi } from "../api/auth.api.js";
import { showErrorToast } from "../components/toast.js";
import { setPending } from "../components/states.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Olvidé mi contraseña" (pública). La respuesta es SIEMPRE la misma, exista
 * o no el correo: esta pantalla muestra siempre la misma confirmación, así
 * que tampoco revela nada.
 */
export function renderForgotPassword(root) {
  root.innerHTML = `
    <main class="auth-screen" id="main-content" tabindex="-1">
      <div class="auth-card">
        <h1 class="auth-title">Recupera tu acceso</h1>
        <div id="forgot" aria-live="polite">
          <p class="auth-subtitle">Escribe el correo de tu cuenta. Te enviaremos un enlace para crear una contraseña nueva.</p>
          <form id="forgot-form" class="auth-form" data-requires-network>
            <div class="auth-field">
              <label for="forgot-email">Correo</label>
              <input id="forgot-email" type="email" name="email" required maxlength="150" autocomplete="username" />
            </div>
            <button type="submit" class="btn btn--primary btn--block">Enviar enlace</button>
          </form>
        </div>
        <p class="auth-hint auth-hint--after"><a href="#/login">Volver a iniciar sesión</a></p>
      </div>
    </main>`;

  const container = root.querySelector("#forgot");
  const form = root.querySelector("#forgot-form");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.elements.email.value.trim();
    const done = setPending(form.querySelector("button[type=submit]"), "Enviando…");
    try {
      const { message } = await authApi.requestPasswordReset(email);
      container.innerHTML = `
        <div class="state state--empty" role="status">
          <p class="state__title">Revisa tu correo</p>
          <p class="state__message">${escapeHtml(message)}</p>
          <p class="state__message">Si no lo ves en unos minutos, revisa también el correo no deseado. Puedes pedir otro enlace pasado un minuto.</p>
        </div>`;
    } catch (err) {
      // Solo llega aquí sin red o por el límite de solicitudes (429).
      done();
      showErrorToast(err);
    }
  });
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderForgotPassword(root);

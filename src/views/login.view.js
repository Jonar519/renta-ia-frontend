import { authApi } from "../api/auth.api.js";
import { startSession } from "../auth/session.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { setPending } from "../components/states.js";

/**
 * Inicio de sesión. No hay registro público: las cuentas se crean por
 * invitación de un administrador, y la persona invitada activa la suya desde
 * el enlace que recibe por correo. (El rediseño de esta pantalla es el bloque B10.)
 *
 * Con verificación en dos pasos activa, la contraseña no basta: la API
 * entrega un paso de verificación (5 minutos, 5 intentos) y aquí se pide el
 * código de la app o, si no se tiene el teléfono, un código de recuperación.
 */
export function renderLogin(root) {
  root.innerHTML = `
    <main class="auth-screen" id="main-content" tabindex="-1">
      <div class="auth-card">
        <h1 class="auth-title">Renta IA</h1>
        <p class="auth-subtitle">Gestión documental contable para tus clientes, con IA que lee, extrae y avisa por ti.</p>

        <form id="login-form" class="auth-form" aria-label="Iniciar sesión">
          <label>Correo
            <input type="email" name="email" required autocomplete="email" />
          </label>
          <label>Contraseña
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <button type="submit" class="btn btn--primary btn--block">Entrar</button>
        </form>
        <p class="auth-hint auth-hint--after"><a href="#/recuperar">¿Olvidaste tu contraseña?</a></p>
        <p class="auth-hint auth-hint--after">¿No tienes cuenta? Las crea el administrador de tu firma: recibirás un enlace por correo para activarla.</p>
      </div>
    </main>
  `;

  const loginForm = root.querySelector("#login-form");

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    const done = setPending(loginForm.querySelector("button[type=submit]"), "Entrando…");

    try {
      const result = await authApi.login({
        email: formData.get("email"),
        password: formData.get("password"),
      });
      if (result.mfaRequired) renderMfaStep(root, result.challengeToken);
      else welcome(result);
    } catch (err) {
      showErrorToast(err);
    } finally {
      done();
    }
  });
}

function welcome(session) {
  startSession(session);
  showToast(`Bienvenido, ${session.user.name}`, "success");
  window.location.hash = "/";
}

/** Segundo paso: código de la app (6 dígitos) o código de recuperación. */
function renderMfaStep(root, challengeToken) {
  root.querySelector(".auth-card").innerHTML = `
    <h1 class="auth-title">Verificación en dos pasos</h1>
    <p class="auth-subtitle" id="mfa-help">Escribe el código de 6 dígitos que muestra tu app de autenticación.</p>
    <form id="mfa-form" class="auth-form" novalidate>
      <div class="auth-field">
        <label for="mfa-code">Código de la app</label>
        <input id="mfa-code" name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" aria-describedby="mfa-help mfa-error" />
      </div>
      <p class="form-hint form-hint--error" id="mfa-error" role="alert"></p>
      <button type="submit" class="btn btn--primary btn--block">Verificar</button>
    </form>
    <p class="auth-hint auth-hint--after"><button type="button" class="btn btn--ghost btn--small" id="mfa-mode">Usar un código de recuperación</button></p>
    <p class="auth-hint auth-hint--after"><a href="#/login" id="mfa-back">Volver a iniciar sesión</a></p>`;

  const form = root.querySelector("#mfa-form");
  const input = form.elements.code;
  const label = form.querySelector("label");
  const help = root.querySelector("#mfa-help");
  const errorBox = root.querySelector("#mfa-error");
  const modeButton = root.querySelector("#mfa-mode");
  let recovery = false;
  input.focus();

  // "#/login" ya es la ruta actual (no hay hashchange): se vuelve a pintar el login.
  root.querySelector("#mfa-back").addEventListener("click", (event) => {
    event.preventDefault();
    renderLogin(root);
  });

  modeButton.addEventListener("click", () => {
    recovery = !recovery;
    label.textContent = recovery ? "Código de recuperación" : "Código de la app";
    help.textContent = recovery
      ? "Escribe uno de tus códigos de recuperación (XXXX-XXXX-XXXX-XXXX). Cada uno sirve una sola vez."
      : "Escribe el código de 6 dígitos que muestra tu app de autenticación.";
    modeButton.textContent = recovery ? "Usar el código de la app" : "Usar un código de recuperación";
    input.inputMode = recovery ? "text" : "numeric";
    input.autocomplete = recovery ? "off" : "one-time-code";
    input.maxLength = recovery ? 24 : 6;
    input.value = "";
    errorBox.textContent = "";
    input.focus();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const code = input.value.trim();
    errorBox.textContent = "";
    if (recovery ? code.replace(/[\s-]/g, "").length !== 16 : !/^\d{6}$/.test(code)) {
      errorBox.textContent = recovery ? "El código de recuperación tiene 16 caracteres." : "El código tiene 6 dígitos.";
      input.focus();
      return;
    }
    const done = setPending(form.querySelector("button[type=submit]"), "Verificando…");
    try {
      welcome(await authApi.loginMfa(challengeToken, code));
    } catch (err) {
      done();
      if (err.code === "mfa_challenge_invalid") {
        // Venció (5 min) o se agotaron los intentos: se empieza de nuevo.
        showToast(err.message, "error");
        renderLogin(root);
        return;
      }
      errorBox.textContent = err.message;
      input.select();
    }
  });
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderLogin(root);

import { authApi } from "../api/auth.api.js";
import { startSession } from "../auth/session.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { setPending } from "../components/states.js";

/**
 * Inicio de sesión. No hay registro público: las cuentas se crean por
 * invitación de un administrador, y la persona invitada activa la suya desde
 * el enlace que recibe por correo. (El rediseño de esta pantalla es el bloque B10.)
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
      startSession(result);
      showToast(`Bienvenido, ${result.user.name}`, "success");
      window.location.hash = "/";
    } catch (err) {
      showErrorToast(err);
    } finally {
      done();
    }
  });
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderLogin(root);

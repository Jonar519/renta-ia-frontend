import { authApi } from "../api/auth.api.js";
import { bindRetry, errorStateHtml, skeletonBlockHtml } from "../components/states.js";
import { getState, setAuth } from "../state/store.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Confirmar correo" (pública, B11): se llega desde el enlace enviado al
 * correo NUEVO (#/confirmar-correo/<token>). Como en las demás pantallas con
 * token, este sale de la barra de direcciones apenas se lee y viaja en el
 * cuerpo de la petición. No exige sesión: el enlace prueba que el correo es tuyo.
 */
const shell = (body) => `
  <main class="auth-screen" id="main-content" tabindex="-1">
    <div class="auth-card">
      <h1 class="auth-title">Confirmar correo</h1>
      <div id="confirm-email" aria-live="polite">${body}</div>
    </div>
  </main>`;

const nextLink = () =>
  getState().user
    ? `<a class="btn btn--primary btn--block" href="#/profile">Ir a Mi perfil</a>`
    : `<a class="btn btn--primary btn--block" href="#/login">Iniciar sesión</a>`;

const message = (tone, title, text) => `
  <div class="state state--${tone}"${tone === "error" ? ' role="alert"' : ""}>
    <p class="state__title">${title}</p>
    <p class="state__message">${text}</p>
  </div>
  ${nextLink()}`;

export function renderConfirmEmail(root, token) {
  root.innerHTML = shell("");
  const box = root.querySelector("#confirm-email");
  if (!token) {
    box.innerHTML = message(
      "empty",
      "Abre el enlace que recibiste por correo.",
      "Por seguridad, el enlace se borra de la barra de direcciones apenas se usa."
    );
    return;
  }
  history.replaceState(history.state, "", "#/confirmar-correo");

  async function confirm() {
    box.innerHTML = skeletonBlockHtml({ lines: 2, label: "Confirmando tu correo…" });
    box.setAttribute("aria-busy", "true");
    try {
      const { email } = await authApi.confirmEmailChange(token);
      // Si esta pestaña tiene la sesión de esa cuenta, el menú muestra ya el correo nuevo.
      const { token: access, user } = getState();
      if (user) setAuth(access, { ...user, email });
      box.innerHTML = message(
        "empty",
        "Listo: tu correo cambió.",
        `Desde ahora inicias sesión con <strong>${escapeHtml(email)}</strong>. Avisamos al correo anterior.`
      );
    } catch (err) {
      if (err.status === 410 || err.status === 409) {
        box.innerHTML = message(
          "error",
          err.status === 409 ? "Ese correo ya está en uso." : "Este enlace no es válido o ya venció.",
          "Puedes pedir el cambio de nuevo desde Mi perfil. Los enlaces duran 24 horas y sirven una sola vez."
        );
      } else {
        box.innerHTML = errorStateHtml(err.message, { title: "No se pudo confirmar tu correo." });
      }
    } finally {
      box.removeAttribute("aria-busy");
    }
  }
  bindRetry(box, confirm);
  return confirm();
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root, params) => renderConfirmEmail(root, params.token);

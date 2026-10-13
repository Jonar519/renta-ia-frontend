import { authApi } from "../api/auth.api.js";
import { showToast } from "../components/toast.js";
import { clearAuth, getState } from "../state/store.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { renderTokenPage } from "./tokenPage.js";

/**
 * "Nueva contraseña" (pública): la persona abre el enlace del correo
 * (#/restablecer/<token>). Lo común con "Completa tu cuenta" está en
 * tokenPage.js. Al cambiarla se cierran TODAS las sesiones de la cuenta.
 */
const INVALID_HTML = `
  <div class="state state--error" role="alert">
    <p class="state__title">Este enlace para restablecer la contraseña no es válido o ya venció.</p>
    <p class="state__message">Los enlaces duran 15 minutos y sirven una sola vez. Si pediste otro, solo sirve el más reciente.</p>
    <a class="btn btn--ghost btn--small" href="#/recuperar">Pedir un enlace nuevo</a>
  </div>`;

export function renderResetPassword(root, token) {
  return renderTokenPage(root, {
    title: "Crea una contraseña nueva",
    token,
    cleanHash: "#/restablecer",
    invalidHtml: INVALID_HTML,
    lookup: (t) => authApi.lookupPasswordReset(t),
    introHtml: () =>
      `<p class="auth-subtitle">Al guardarla se cerrarán todas tus sesiones abiertas, en todos tus dispositivos.</p>`,
    footerHtml: ({ expiresAt }) =>
      `<p class="auth-hint auth-hint--after">El enlace vence a las <span class="num">${escapeHtml(new Date(expiresAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" }))}</span> y sirve una sola vez.</p>`,
    labels: {
      password: "Contraseña nueva",
      confirm: "Repite la contraseña nueva",
      submit: "Guardar contraseña",
      pending: "Guardando…",
    },
    async submit(t, password) {
      await authApi.confirmPasswordReset(t, password);
      // El servidor ya cerró todas las sesiones; si este navegador tenía una, se olvida.
      if (getState().user) clearAuth();
      showToast("Tu contraseña se actualizó y se cerraron todas tus sesiones. Inicia sesión con la nueva.", "success");
      window.location.hash = "/login";
    },
  });
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root, params) => renderResetPassword(root, params.token);

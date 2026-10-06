import { authApi } from "../api/auth.api.js";
import { startSession } from "../auth/session.js";
import { ROLE_LABELS } from "../auth/roles.js";
import { showToast } from "../components/toast.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { renderTokenPage } from "./tokenPage.js";

/**
 * "Completa tu cuenta": la persona invitada abre el enlace del correo
 * (#/invitacion/<token>) y define SU contraseña. Pública (sin sesión). Lo
 * común con "Nueva contraseña" (token fuera de la barra, verificación,
 * contraseña doble) está en tokenPage.js.
 */
const INVALID_HTML = `
  <div class="state state--error" role="alert">
    <p class="state__title">Este enlace de invitación no es válido o ya venció.</p>
    <p class="state__message">Puede que ya hayas activado tu cuenta, que te hayan enviado uno más nuevo o que hayan pasado 72 horas. Pide a tu administrador un enlace nuevo.</p>
    <a class="btn btn--ghost btn--small" href="#/login">Ir a iniciar sesión</a>
  </div>`;

export function renderCompleteAccount(root, token) {
  return renderTokenPage(root, {
    title: "Completa tu cuenta",
    token,
    cleanHash: "#/invitacion",
    invalidHtml: INVALID_HTML,
    lookup: (t) => authApi.lookupInvitation(t),
    introHtml: (inv) =>
      `<p class="auth-subtitle">Hola, <strong>${escapeHtml(inv.name)}</strong>. Te invitaron a Renta IA como
        <strong>${escapeHtml(ROLE_LABELS[inv.role] ?? inv.role)}</strong>. Define tu contraseña para activar tu cuenta.</p>`,
    extraFieldsHtml: (inv) => `
      <div class="auth-field">
        <label for="complete-email">Correo</label>
        <input id="complete-email" type="email" name="username" value="${escapeHtml(inv.email)}" autocomplete="username" readonly />
      </div>`,
    footerHtml: (inv) =>
      `<p class="auth-hint auth-hint--after">El enlace vence el <span class="num">${escapeHtml(new Date(inv.expiresAt).toLocaleString("es-CO"))}</span> y sirve una sola vez.</p>`,
    labels: {
      password: "Contraseña",
      confirm: "Repite la contraseña",
      submit: "Activar mi cuenta",
      pending: "Activando…",
    },
    async submit(t, password) {
      const session = await authApi.acceptInvitation(t, password);
      startSession(session);
      showToast(`Tu cuenta está activa. Te damos la bienvenida, ${session.user.name}.`, "success");
      window.location.hash = "/";
    },
  });
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root, params) => renderCompleteAccount(root, params.token);

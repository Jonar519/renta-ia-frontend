import { mfaApi } from "../api/mfa.api.js";
import { renderSidebar, bindSidebarEvents } from "../components/sidebar.js";
import { bindRetry, errorStateHtml, setPending, skeletonBlockHtml } from "../components/states.js";
import { bindPasswordFields, passwordFieldHtml } from "../components/passwordField.js";
import { showToast } from "../components/toast.js";
import { getState, setAuth } from "../state/store.js";
import { escapeHtml } from "../utils/escapeHtml.js";
import { mountActiveSessions } from "./activeSessions.js";

/**
 * "Seguridad": verificación en dos pasos (TOTP) de la propia cuenta y sus
 * sesiones activas (B13; activeSessions.js).
 *
 *  Desactivada → (contraseña) → QR + clave manual → (código) → códigos de
 *  recuperación (UNA vez) → Activa.
 *
 * Para un admin es obligatoria: mientras no la active, el guard de rutas solo
 * lo deja estar aquí, y no puede desactivarla (lo decide la API). El QR lo
 * genera el servidor (SVG) y se muestra como imagen: el navegador no
 * descarga ninguna librería de QR (presupuesto de JS).
 */
const CODE_FIELD = `
  <div class="auth-field">
    <label for="mfa-code">Código de 6 dígitos de la app</label>
    <input id="mfa-code" name="code" required inputmode="numeric" autocomplete="one-time-code" maxlength="6" />
  </div>`;

const formError = (id) => `<p class="form-hint form-hint--error" id="${id}" role="alert"></p>`;

/** El servidor responde con un mensaje claro (contraseña o código incorrectos, límite…). */
function bindForm(form, pendingText, action) {
  const errorBox = form.querySelector("[role=alert]");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.textContent = "";
    const done = setPending(form.querySelector("button[type=submit]"), pendingText);
    try {
      await action(new FormData(form));
    } catch (err) {
      done();
      errorBox.textContent = err.message;
      form.querySelector("input")?.focus();
    }
  });
}

function markMfaEnabled() {
  const { token, user } = getState();
  if (user) setAuth(token, { ...user, mfaEnabled: true });
  document.querySelector(".route-notice")?.remove(); // "primero debes activar…" ya no aplica
}

/** Admin sin MFA: la API solo le permite activarlo; las sesiones se muestran después. */
const mfaPending = () => {
  const { user } = getState();
  return user?.role === "admin" && user.mfaEnabled === false;
};

export async function renderSecurity(root) {
  root.innerHTML = `
    <div class="app-shell">
      ${renderSidebar("security")}
      <main class="main" id="main-content" tabindex="-1">
        <header class="main__header">
          <div>
            <h1 class="page-title">Seguridad</h1>
            <p class="page-subtitle">Protege tu cuenta con un segundo paso al iniciar sesión y revisa dónde está abierta.</p>
          </div>
        </header>
        <section class="panel" aria-labelledby="mfa-title">
          <h2 id="mfa-title">Verificación en dos pasos</h2>
          <div id="mfa" aria-live="polite"></div>
        </section>
        <section class="panel" aria-labelledby="sessions-title" id="sessions-panel" hidden>
          <h2 id="sessions-title">Sesiones activas</h2>
        </section>
      </main>
    </div>`;
  bindSidebarEvents(root);
  const box = root.querySelector("#mfa");
  const sessionsPanel = root.querySelector("#sessions-panel");
  function showSessions() {
    if (!sessionsPanel.hidden || mfaPending()) return;
    sessionsPanel.hidden = false;
    mountActiveSessions(sessionsPanel);
  }
  const focusFirst = () => box.querySelector("input, button")?.focus();

  async function load() {
    box.innerHTML = skeletonBlockHtml({ lines: 3 });
    box.setAttribute("aria-busy", "true");
    try {
      const status = await mfaApi.status();
      if (status.enabled) showEnabled(status);
      else showDisabled(status);
      showSessions();
    } catch (err) {
      if (err.name === "AbortError") return;
      box.innerHTML = errorStateHtml(err.message);
    } finally {
      box.removeAttribute("aria-busy");
    }
  }
  bindRetry(box, load);

  function showDisabled({ required }) {
    box.innerHTML = `
      ${
        required
          ? `<p class="state__title">Tu rol (Administrador) exige la verificación en dos pasos. Actívala para seguir usando Renta IA.</p>`
          : ""
      }
      <p>Al iniciar sesión, además de tu contraseña, te pediremos un código de 6 dígitos de una app de autenticación (Google o Microsoft Authenticator, 1Password…). Al activarla se cerrarán tus otras sesiones.</p>
      <form id="mfa-start" class="auth-form" novalidate>
        ${passwordFieldHtml({ id: "mfa-password", name: "password", label: "Confirma tu contraseña actual", autocomplete: "current-password" })}
        ${formError("mfa-start-error")}
        <div class="form-actions"><button type="submit" class="btn btn--primary">Empezar</button></div>
      </form>`;
    bindPasswordFields(box);
    bindForm(box.querySelector("#mfa-start"), "Preparando…", async (data) =>
      showSetup(await mfaApi.setup(data.get("password")))
    );
  }

  function showSetup({ secret, qrSvg, expiresAt }) {
    const grouped = secret.match(/.{1,4}/g).join(" ");
    const until = new Date(expiresAt).toLocaleTimeString("es-CO", { hour: "2-digit", minute: "2-digit" });
    box.innerHTML = `
      <ol class="mfa-steps">
        <li>
          <p>Escanea este código QR con tu app de autenticación.</p>
          <img class="mfa-qr" src="data:image/svg+xml,${encodeURIComponent(qrSvg)}" width="200" height="200" alt="Código QR para agregar Renta IA a tu app de autenticación" />
        </li>
        <li>
          <p>¿No puedes escanearlo? En la app, ingresa esta clave:</p>
          <p><code class="num" id="mfa-secret">${escapeHtml(grouped)}</code></p>
        </li>
        <li>
          <p>Escribe el código que muestra la app para confirmar.</p>
          <form id="mfa-enable" class="auth-form" novalidate>
            ${CODE_FIELD}
            ${formError("mfa-enable-error")}
            <div class="form-actions">
              <button type="button" class="btn btn--ghost" id="mfa-cancel">Cancelar</button>
              <button type="submit" class="btn btn--primary">Activar</button>
            </div>
          </form>
        </li>
      </ol>
      <p class="form-hint">Esta configuración vence a las <span class="num">${escapeHtml(until)}</span>.</p>`;
    box.querySelector("#mfa-cancel").addEventListener("click", load);
    bindForm(box.querySelector("#mfa-enable"), "Activando…", async (data) => {
      const { recoveryCodes } = await mfaApi.enable(data.get("code"));
      markMfaEnabled();
      showRecoveryCodes(recoveryCodes, true);
    });
    focusFirst();
  }

  function showRecoveryCodes(codes, justEnabled) {
    box.innerHTML = `
      ${justEnabled ? `<p class="state__title">La verificación en dos pasos está activa.</p>` : ""}
      <h3>Guarda tus códigos de recuperación</h3>
      <p>Si pierdes el teléfono, cada código te deja entrar <strong>una sola vez</strong>. No los volveremos a mostrar: guárdalos en un lugar seguro.</p>
      <ol class="mfa-codes num" id="mfa-codes">${codes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" id="mfa-download">Descargar (.txt)</button>
      </div>
      <form id="mfa-done" class="auth-form">
        <label class="checkbox"><input type="checkbox" name="saved" required /> Los guardé en un lugar seguro</label>
        <div class="form-actions"><button type="submit" class="btn btn--primary">Listo</button></div>
      </form>`;
    box.querySelector("#mfa-download").addEventListener("click", () => {
      const text = `Renta IA: códigos de recuperación (un solo uso cada uno)\n\n${codes.join("\n")}\n`;
      const link = document.createElement("a");
      link.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
      link.download = "renta-ia-codigos-de-recuperacion.txt";
      link.click();
      URL.revokeObjectURL(link.href);
    });
    box.querySelector("#mfa-done").addEventListener("submit", (event) => {
      event.preventDefault();
      showToast("Listo. Desde ahora te pediremos el código al iniciar sesión.", "success");
      load();
    });
    box.querySelector("h3").setAttribute("tabindex", "-1");
    box.querySelector("h3").focus();
  }

  function showEnabled({ enabledAt, recoveryCodesRemaining, required }) {
    const since = new Date(enabledAt).toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });
    const low = recoveryCodesRemaining <= 3;
    box.innerHTML = `
      <p><span class="badge badge--success">Activa</span> desde el <span class="num">${escapeHtml(since)}</span>.</p>
      <p${low ? ' class="form-hint--error"' : ""}>Te quedan <span class="num">${recoveryCodesRemaining}</span> códigos de recuperación sin usar.${low ? " Genera códigos nuevos." : ""}</p>
      <details>
        <summary>Generar códigos de recuperación nuevos</summary>
        <form id="mfa-regenerate" class="auth-form" novalidate>
          <p class="form-hint">Los anteriores dejarán de servir.</p>
          ${CODE_FIELD}
          ${formError("mfa-regenerate-error")}
          <div class="form-actions"><button type="submit" class="btn btn--primary">Generar</button></div>
        </form>
      </details>
      ${
        required
          ? `<p class="form-hint">Tu rol la exige: no se puede desactivar. Si pierdes el teléfono y los códigos, pide a otro administrador que la restablezca.</p>`
          : `<details>
              <summary>Desactivar la verificación en dos pasos</summary>
              <form id="mfa-disable" class="auth-form" novalidate>
                ${passwordFieldHtml({ id: "mfa-off-password", name: "password", label: "Contraseña actual", autocomplete: "current-password" })}
                <div class="auth-field">
                  <label for="mfa-off-code">Código de la app o de recuperación</label>
                  <input id="mfa-off-code" name="code" required autocomplete="one-time-code" maxlength="24" />
                </div>
                ${formError("mfa-disable-error")}
                <div class="form-actions"><button type="submit" class="btn btn--danger">Desactivar</button></div>
              </form>
            </details>`
      }`;
    bindPasswordFields(box);
    bindForm(box.querySelector("#mfa-regenerate"), "Generando…", async (data) => {
      showRecoveryCodes((await mfaApi.regenerateCodes(data.get("code"))).recoveryCodes, false);
    });
    const disable = box.querySelector("#mfa-disable");
    if (disable) {
      bindForm(disable, "Desactivando…", async (data) => {
        await mfaApi.disable(data.get("password"), data.get("code"));
        const { token, user } = getState();
        if (user) setAuth(token, { ...user, mfaEnabled: false });
        showToast("Desactivaste la verificación en dos pasos.", "info");
        load();
      });
    }
  }

  await load();
}

/** Punto de entrada de la ruta (tabla de rutas de main.js). */
export default (root) => renderSecurity(root);

import { bindRetry, errorStateHtml, setPending, skeletonBlockHtml } from "../components/states.js";
import { bindPasswordFields, passwordFieldHtml, PASSWORD_HINT } from "../components/passwordField.js";

/**
 * Pantalla pública a la que se llega desde un enlace de correo con token
 * ("Completa tu cuenta", "Nueva contraseña"). Lo común a ambas:
 *
 *  - El token sale de la barra de direcciones apenas se lee
 *    (history.replaceState): no queda en el historial ni en una captura.
 *    Si se recarga, se pide abrir de nuevo el enlace del correo.
 *  - El token viaja en el CUERPO de las peticiones, nunca en la URL.
 *  - Se verifica el enlace antes de mostrar el formulario (skeleton, error
 *    con Reintentar, o "no es válido o ya venció" con un solo mensaje).
 *  - Contraseña dos veces, con "Mostrar contraseña" y la política explicada;
 *    los motivos de rechazo de la API se muestran tal cual.
 */
const NO_TOKEN_HTML = `
  <div class="state state--empty">
    <p class="state__title">Abre el enlace que recibiste por correo.</p>
    <p class="state__message">Por seguridad, el enlace se borra de la barra de direcciones apenas se usa. Si recargaste la página, vuelve a abrirlo desde el correo.</p>
  </div>`;

/**
 * @param {Element} root
 * @param {object} page
 * @param {string} page.title
 * @param {string | undefined} page.token
 * @param {string} page.cleanHash          ruta sin el token ("#/invitacion")
 * @param {string} page.invalidHtml        estado de enlace inválido o vencido
 * @param {(token: string) => Promise<any>} page.lookup
 * @param {(data: any) => string} page.introHtml   HTML ya escapado (antes del formulario)
 * @param {(data: any) => string} [page.extraFieldsHtml]
 * @param {(data: any) => string} page.footerHtml
 * @param {{ password: string, confirm: string, submit: string, pending: string }} page.labels
 * @param {(token: string, password: string) => Promise<void>} page.submit  hace la llamada y navega
 */
export function renderTokenPage(root, page) {
  root.innerHTML = `
    <main class="auth-screen" id="main-content" tabindex="-1">
      <div class="auth-card">
        <h1 class="auth-title">${page.title}</h1>
        <div id="token-page" aria-live="polite"></div>
      </div>
    </main>`;
  const container = root.querySelector("#token-page");
  const { token } = page;
  if (!token) {
    container.innerHTML = NO_TOKEN_HTML;
    return;
  }
  history.replaceState(history.state, "", page.cleanHash);

  async function load() {
    container.innerHTML = skeletonBlockHtml({ lines: 4, label: "Verificando el enlace…" });
    container.setAttribute("aria-busy", "true");
    try {
      showForm(await page.lookup(token));
    } catch (err) {
      container.innerHTML =
        err.status === 410 || err.status === 400
          ? page.invalidHtml
          : errorStateHtml(err.message, { title: "No se pudo verificar el enlace." });
    } finally {
      container.removeAttribute("aria-busy");
    }
  }
  bindRetry(container, load);

  function showForm(data) {
    container.innerHTML = `
      ${page.introHtml(data)}
      <form id="token-form" class="auth-form" novalidate>
        ${page.extraFieldsHtml?.(data) ?? ""}
        ${passwordFieldHtml({ id: "token-password", name: "password", label: page.labels.password, autocomplete: "new-password", minlength: 10, describedBy: "password-hint" })}
        <p class="auth-hint" id="password-hint">${PASSWORD_HINT}</p>
        ${passwordFieldHtml({ id: "token-confirm", name: "confirm", label: page.labels.confirm, autocomplete: "new-password", minlength: 10 })}
        <p class="form-hint form-hint--error" id="token-error" role="alert"></p>
        <button type="submit" class="btn btn--primary btn--block">${page.labels.submit}</button>
      </form>
      ${page.footerHtml(data)}`;

    const form = container.querySelector("#token-form");
    const errorBox = container.querySelector("#token-error");
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
      const done = setPending(form.querySelector("button[type=submit]"), page.labels.pending);
      try {
        await page.submit(token, password);
      } catch (err) {
        done();
        if (err.status === 410) {
          container.innerHTML = page.invalidHtml;
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

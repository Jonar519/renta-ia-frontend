import { usersApi } from "../api/users.api.js";
import { logout } from "../auth/session.js";
import { bindPasswordFields, passwordFieldHtml } from "../components/passwordField.js";
import { setPending } from "../components/states.js";
import { showToast } from "../components/toast.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Tus datos" en Mi perfil (B14): descargar una copia (JSON) y eliminar la
 * cuenta. Qué se borra y qué se conserva: renta-ia-backend/docs/data-retention.md.
 * La pantalla lo resume con las mismas palabras: los documentos que subiste
 * se quedan en el expediente del cliente, con autor "Cuenta eliminada".
 */
const errorBox = (id) => `<p class="form-hint form-hint--error" id="${id}" role="alert"></p>`;

function download(data) {
  const day = new Date().toISOString().slice(0, 10);
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  link.download = `renta-ia-mis-datos-${day}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Monta la sección en `slot` (un hueco al final de Mi perfil). `me`: la cuenta
 * (para saber si pide código de MFA). Si mientras llegaba el estado se volvió
 * a pintar el perfil, ese hueco ya no está en la página: lo que se pinte en él
 * no se ve, y el perfil nuevo monta la sección en su propio hueco.
 */
export async function mountAccountData(slot, me) {
  const deletion = await usersApi.deletionStatus().catch(() => ({ canDelete: true, reason: null }));
  const container = slot;
  container.insertAdjacentHTML(
    "beforeend",
    `<section class="panel" aria-labelledby="account-data-title">
      <h2 id="account-data-title">Tus datos</h2>

      <h3>Descargar mis datos</h3>
      <p>Una copia en un archivo (JSON) de tu cuenta, tus sesiones, tu actividad, tus conversaciones con la IA y qué documentos subiste (sin los archivos). De los clientes que atiendes solo va cuántos son: sus datos no son tuyos.</p>
      <form id="export-form" class="auth-form" novalidate>
        ${passwordFieldHtml({ id: "export-password", name: "password", label: "Confirma tu contraseña actual", autocomplete: "current-password" })}
        ${errorBox("export-error")}
        <div class="form-actions"><button type="submit" class="btn btn--primary">Descargar mis datos</button></div>
      </form>

      <h3>Eliminar mi cuenta</h3>
      <p>No se puede deshacer. Se borran tu nombre, correo, teléfono, foto y contraseña, tus sesiones y tus conversaciones con la IA. Los documentos que subiste se quedan en el expediente de su cliente, con autor "Cuenta eliminada", y el registro de actividad se conserva por seguridad.</p>
      ${
        deletion.canDelete
          ? `<form id="delete-form" class="auth-form" novalidate>
              ${passwordFieldHtml({ id: "delete-password", name: "password", label: "Contraseña actual", autocomplete: "current-password" })}
              ${
                me.mfaEnabled
                  ? `<div class="auth-field">
                      <label for="delete-code">Código de la app o de recuperación</label>
                      <input id="delete-code" name="code" required autocomplete="one-time-code" maxlength="24" />
                    </div>`
                  : ""
              }
              <label class="checkbox"><input type="checkbox" name="understood" required /> Entiendo que no se puede deshacer</label>
              ${errorBox("delete-error")}
              <div class="form-actions"><button type="submit" class="btn btn--ghost btn--danger">Eliminar mi cuenta</button></div>
            </form>`
          : `<p class="form-hint form-hint--error" id="delete-blocked">${escapeHtml(deletion.reason)}</p>`
      }
      <dialog id="delete-dialog" class="dialog" aria-labelledby="delete-title" aria-describedby="delete-text">
        <h2 id="delete-title">¿Eliminar tu cuenta?</h2>
        <p id="delete-text">Se cerrarán todas tus sesiones y no podrás volver a entrar con esta cuenta. No se puede deshacer.</p>
        <div class="form-actions">
          <button type="button" class="btn btn--ghost" data-dialog="back" autofocus>Volver</button>
          <button type="button" class="btn btn--primary btn--danger-fill" data-dialog="confirm">Eliminar mi cuenta</button>
        </div>
      </dialog>
    </section>`
  );
  bindPasswordFields(container);

  const exportForm = container.querySelector("#export-form");
  exportForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const box = exportForm.querySelector("[role=alert]");
    box.textContent = "";
    const done = setPending(exportForm.querySelector("button[type=submit]"), "Preparando…");
    try {
      download(await usersApi.exportData(new FormData(exportForm).get("password")));
      exportForm.reset();
      showToast("Descargamos tus datos.", "success");
    } catch (err) {
      box.textContent = err.message;
      exportForm.querySelector("input").focus();
    } finally {
      done();
    }
  });

  const form = container.querySelector("#delete-form");
  if (!form) return;
  const dialog = container.querySelector("#delete-dialog");
  const submit = form.querySelector("button[type=submit]");
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const box = form.querySelector("[role=alert]");
    box.textContent = "";
    const data = new FormData(form);
    if (!data.get("password") || (me.mfaEnabled && !data.get("code")?.trim())) {
      box.textContent = me.mfaEnabled ? "Escribe tu contraseña y un código." : "Escribe tu contraseña.";
      form.querySelector("input").focus();
      return;
    }
    if (!data.get("understood")) {
      box.textContent = "Marca la casilla para confirmar que entiendes que no se puede deshacer.";
      form.querySelector("[name=understood]").focus();
      return;
    }
    dialog.showModal();
  });

  let deleting = false;
  dialog.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-dialog]")?.dataset.dialog;
    if (action === "back") dialog.close();
    if (action !== "confirm") return;
    const data = new FormData(form);
    const done = setPending(event.target.closest("[data-dialog]"), "Eliminando…");
    try {
      await usersApi.deleteAccount(data.get("password"), data.get("code")?.trim() || undefined);
      deleting = true;
      dialog.close();
      showToast("Eliminamos tu cuenta. Gracias por usar Renta IA.", "success");
      await logout(); // la sesión ya no existe en el servidor: se cierra aquí y en las otras pestañas
    } catch (err) {
      done();
      dialog.close();
      form.querySelector("[role=alert]").textContent = err.message;
      form.querySelector("input").focus();
    }
  });
  dialog.addEventListener("close", () => {
    // Volver o Escape: el foco vuelve al botón que lo abrió.
    if (!deleting && !form.querySelector("[role=alert]").textContent) submit.focus();
  });
}

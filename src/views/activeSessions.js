import { usersApi } from "../api/users.api.js";
import { bindRetry, errorStateHtml, setPending, skeletonBlockHtml } from "../components/states.js";
import { showErrorToast, showToast } from "../components/toast.js";
import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * "Sesiones activas" (B13), dentro de Seguridad: dónde está abierta la cuenta
 * y cerrar una sesión o todas las demás. Lo que no se sabe (sesiones de antes
 * de B13, o una IP sin ubicación) se muestra como "desconocida": nunca se
 * inventa. La ubicación es APROXIMADA y así se rotula.
 */
const dateTime = (iso) =>
  new Date(iso).toLocaleString("es-CO", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
const unknown = '<span class="session__unknown">desconocida</span>';

function sessionHtml(s) {
  const device = s.device ? escapeHtml(s.device) : "Dispositivo desconocido";
  return `
    <li class="session" data-session-id="${escapeHtml(s.id)}">
      <div class="session__info">
        <p class="session__device">${device}${s.current ? ' <span class="badge badge--info">Esta sesión</span>' : ""}</p>
        <dl class="session__meta">
          <div><dt>Ubicación aproximada</dt><dd>${s.location ? escapeHtml(s.location) : unknown}</dd></div>
          <div><dt>IP</dt><dd>${s.ip ? `<span class="num">${escapeHtml(s.ip)}</span>` : unknown}</dd></div>
          <div><dt>Inició</dt><dd class="session__date">${escapeHtml(dateTime(s.createdAt))}</dd></div>
          <div><dt>Última actividad</dt><dd class="session__date">${escapeHtml(dateTime(s.lastSeenAt))}</dd></div>
        </dl>
      </div>
      ${
        s.current
          ? ""
          : `<button type="button" class="btn btn--ghost" data-close="${escapeHtml(s.id)}" aria-label="Cerrar la sesión de ${device}">Cerrar sesión</button>`
      }
    </li>`;
}

/** Monta la sección en `panel` (un <section> con un h2 #sessions-title). */
export function mountActiveSessions(panel) {
  panel.insertAdjacentHTML(
    "beforeend",
    `<p>Dónde está abierta tu cuenta. Si no reconoces una sesión, ciérrala y cambia tu contraseña.</p>
    <div id="sessions" aria-live="polite"></div>
    <p class="form-hint">La ubicación es aproximada: se calcula con la IP y suele ser la de tu proveedor de internet. La IP se guarda sin su última parte. La última actividad se actualiza cada vez que la sesión renueva su acceso (más o menos cada 15 minutos mientras se usa).</p>
    <dialog id="close-others-dialog" class="dialog" aria-labelledby="close-others-title" aria-describedby="close-others-text">
      <h2 id="close-others-title">¿Cerrar las demás sesiones?</h2>
      <p id="close-others-text"></p>
      <div class="form-actions">
        <button type="button" class="btn btn--ghost" data-dialog="back" autofocus>Volver</button>
        <button type="button" class="btn btn--primary btn--danger-fill" data-dialog="confirm">Cerrar las demás</button>
      </div>
    </dialog>`
  );
  const box = panel.querySelector("#sessions");
  const dialog = panel.querySelector("#close-others-dialog");
  const title = panel.querySelector("#sessions-title");
  title.setAttribute("tabindex", "-1");
  let others = 0;

  async function load() {
    box.innerHTML = skeletonBlockHtml({ lines: 3 });
    box.setAttribute("aria-busy", "true");
    try {
      const sessions = await usersApi.sessions();
      others = sessions.filter((s) => !s.current).length;
      box.innerHTML = `
        <ul class="session-list">${sessions.map(sessionHtml).join("")}</ul>
        ${
          others
            ? '<div class="form-actions"><button type="button" class="btn btn--ghost" id="close-others">Cerrar todas las demás sesiones</button></div>'
            : '<p class="form-hint">No hay otras sesiones abiertas.</p>'
        }`;
    } catch (err) {
      if (err.name === "AbortError") return;
      box.innerHTML = errorStateHtml(err.message);
    } finally {
      box.removeAttribute("aria-busy");
    }
  }
  bindRetry(box, load);

  box.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-close]");
    if (button) {
      const done = setPending(button, "Cerrando…");
      try {
        await usersApi.closeSession(button.dataset.close);
        showToast("Cerraste esa sesión.", "success");
        await load();
        title.focus(); // la fila ya no existe
      } catch (err) {
        done();
        showErrorToast(err);
      }
      return;
    }
    if (event.target.closest("#close-others")) {
      dialog.querySelector("#close-others-text").textContent =
        others === 1
          ? "Se cerrará 1 sesión en otro dispositivo. Esta sigue abierta."
          : `Se cerrarán ${others} sesiones en otros dispositivos. Esta sigue abierta.`;
      dialog.showModal();
    }
  });

  let confirmed = false;
  dialog.addEventListener("click", async (event) => {
    const action = event.target.closest("[data-dialog]")?.dataset.dialog;
    if (action === "back") dialog.close();
    if (action !== "confirm") return;
    const done = setPending(event.target.closest("[data-dialog]"), "Cerrando…");
    try {
      const { closed } = await usersApi.closeOtherSessions();
      confirmed = true;
      dialog.close();
      showToast(closed === 1 ? "Cerraste 1 sesión." : `Cerraste ${closed} sesiones.`, "success");
      await load();
      title.focus();
    } catch (err) {
      showErrorToast(err);
    } finally {
      done();
    }
  });
  dialog.addEventListener("close", () => {
    // Cerrado sin confirmar (Volver o Escape): el foco vuelve al botón que lo abrió.
    if (!confirmed) box.querySelector("#close-others")?.focus();
    confirmed = false;
  });

  return load();
}

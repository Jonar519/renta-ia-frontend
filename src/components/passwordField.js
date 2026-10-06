import { escapeHtml } from "../utils/escapeHtml.js";

/**
 * Campo de contraseña con "Mostrar contraseña" (botón de alternancia).
 *
 * Accesibilidad (patrón toggle button de WAI-ARIA): el botón conserva SIEMPRE
 * el mismo nombre ("Mostrar contraseña") y lo que cambia es aria-pressed; el
 * lector de pantalla anuncia "presionado / no presionado". Cambiar a la vez
 * el texto y aria-pressed daría un anuncio contradictorio.
 *
 * Sin animación: solo cambia el tipo del campo y el estado del botón.
 */
export function passwordFieldHtml({ id, name, label, autocomplete, minlength, describedBy, required = true }) {
  const attrs = [
    `id="${escapeHtml(id)}"`,
    `name="${escapeHtml(name)}"`,
    `type="password"`,
    `autocomplete="${escapeHtml(autocomplete)}"`,
    required ? "required" : "",
    minlength ? `minlength="${minlength}"` : "",
    `maxlength="72"`,
    describedBy ? `aria-describedby="${escapeHtml(describedBy)}"` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return `
    <div class="auth-field">
      <label for="${escapeHtml(id)}">${escapeHtml(label)}</label>
      <div class="password-field">
        <input ${attrs} />
        <button type="button" class="password-field__toggle" aria-pressed="false" aria-controls="${escapeHtml(id)}">
          Mostrar<span class="visually-hidden"> contraseña</span>
        </button>
      </div>
    </div>`;
}

/** Enlaza los botones de mostrar/ocultar dentro de `root`. Al enviar el formulario se vuelven a ocultar. */
export function bindPasswordFields(root) {
  for (const button of root.querySelectorAll(".password-field__toggle")) {
    const input = button.closest(".password-field")?.querySelector("input");
    if (!input) continue;
    const set = (visible) => {
      input.type = visible ? "text" : "password";
      button.setAttribute("aria-pressed", String(visible));
    };
    button.addEventListener("click", () => set(button.getAttribute("aria-pressed") !== "true"));
    // No dejar la contraseña visible después de enviar (ni que el navegador la recuerde como texto).
    input.form?.addEventListener("submit", () => set(false), true);
  }
}

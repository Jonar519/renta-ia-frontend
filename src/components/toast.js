export function showToast(message, type = "info") {
  const root = document.getElementById("toast-root");
  if (!root) return;

  const toast = document.createElement("div");
  toast.className = `toast toast--${type}`;
  // #toast-root es una región aria-live="polite"; los errores se anuncian
  // de inmediato (role="alert" = assertive).
  if (type === "error") toast.setAttribute("role", "alert");
  toast.textContent = message;
  root.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add("toast--visible"));

  setTimeout(() => {
    toast.classList.remove("toast--visible");
    setTimeout(() => toast.remove(), 250);
  }, 4000);
}

/**
 * Muestra el error de una operación. Ignora las cancelaciones (AbortError):
 * cuando el usuario cambia de vista, las peticiones de la vista anterior se
 * cancelan a propósito y no deben aparecer como error en la vista nueva.
 */
export function showErrorToast(err) {
  if (err?.name === "AbortError") return;
  showToast(err?.message ?? String(err), "error");
}

/**
 * Pestañas accesibles (patrón WAI-ARIA "Tabs" con activación automática).
 *
 * Marcado esperado:
 *   <div role="tablist" aria-label="...">
 *     <button role="tab" id="tab-x" aria-controls="panel-x" aria-selected="true">...</button>
 *     ...
 *   </div>
 *   <div role="tabpanel" id="panel-x" aria-labelledby="tab-x" tabindex="0">...</div>
 *
 * Teclado: ← / → cambian de pestaña (circular), Inicio / Fin van a la primera
 * y a la última. Solo la pestaña activa está en el orden de tabulación.
 *
 * @param {ParentNode} root  Contenedor donde buscar el tablist.
 * @param {(tab: HTMLElement) => void} [onChange]  Se llama al activar una pestaña.
 */
export function bindTabs(root, onChange) {
  const tablist = root.querySelector('[role="tablist"]');
  if (!tablist) return;
  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));

  function activate(tab, { focus = false } = {}) {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute("aria-selected", String(selected));
      t.tabIndex = selected ? 0 : -1;
      t.classList.toggle("is-active", selected);
      const panel = root.querySelector(`#${t.getAttribute("aria-controls")}`);
      if (panel) panel.hidden = !selected;
    });
    if (focus) tab.focus();
    if (onChange) onChange(tab);
  }

  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => activate(tab));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      const target = {
        ArrowRight: index === last ? 0 : index + 1,
        ArrowLeft: index === 0 ? last : index - 1,
        Home: 0,
        End: last,
      }[event.key];
      if (target === undefined) return;
      event.preventDefault();
      activate(tabs[target], { focus: true });
    });
  });

  // Estado inicial coherente (tabindex/hidden) según aria-selected del marcado.
  activate(tabs.find((t) => t.getAttribute("aria-selected") === "true") || tabs[0]);
}

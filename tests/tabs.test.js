import { beforeEach, describe, expect, it } from "vitest";
import { bindTabs } from "../src/components/tabs.js";

function render() {
  document.body.innerHTML = `
    <div role="tablist" aria-label="Secciones">
      <button role="tab" id="t1" aria-controls="p1" aria-selected="true">Uno</button>
      <button role="tab" id="t2" aria-controls="p2" aria-selected="false">Dos</button>
      <button role="tab" id="t3" aria-controls="p3" aria-selected="false">Tres</button>
    </div>
    <div role="tabpanel" id="p1" aria-labelledby="t1">1</div>
    <div role="tabpanel" id="p2" aria-labelledby="t2" hidden>2</div>
    <div role="tabpanel" id="p3" aria-labelledby="t3" hidden>3</div>`;
  bindTabs(document);
}

const tab = (id) => document.getElementById(id);
const panel = (id) => document.getElementById(id);
const press = (el, key) => el.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));

describe("bindTabs (patrón WAI-ARIA)", () => {
  beforeEach(render);

  it("estado inicial: solo la pestaña seleccionada es tabulable y su panel visible", () => {
    expect(tab("t1").tabIndex).toBe(0);
    expect(tab("t2").tabIndex).toBe(-1);
    expect(panel("p1").hidden).toBe(false);
    expect(panel("p2").hidden).toBe(true);
  });

  it("click activa la pestaña, actualiza aria-selected y muestra su panel", () => {
    tab("t2").click();
    expect(tab("t2").getAttribute("aria-selected")).toBe("true");
    expect(tab("t1").getAttribute("aria-selected")).toBe("false");
    expect(panel("p2").hidden).toBe(false);
    expect(panel("p1").hidden).toBe(true);
  });

  it("flecha derecha/izquierda mueven foco y selección (de forma circular)", () => {
    tab("t1").focus();
    press(tab("t1"), "ArrowRight");
    expect(document.activeElement).toBe(tab("t2"));
    expect(panel("p2").hidden).toBe(false);

    press(tab("t2"), "ArrowLeft");
    press(tab("t1"), "ArrowLeft");
    expect(document.activeElement).toBe(tab("t3"));
    expect(tab("t3").getAttribute("aria-selected")).toBe("true");
  });

  it("Inicio y Fin van a la primera y a la última pestaña", () => {
    press(tab("t1"), "End");
    expect(document.activeElement).toBe(tab("t3"));
    press(tab("t3"), "Home");
    expect(document.activeElement).toBe(tab("t1"));
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Menú de usuario (patrón "menu button" de WAI-ARIA): teclado, cierre con
 * Escape / clic fuera / Tab, foco y datos. En Chrome real: e2e/guard.spec.js.
 */

vi.mock("../src/auth/session.js", () => ({ logout: vi.fn(async () => {}) }));
const { logout } = await import("../src/auth/session.js");
const { setAuth, clearAuth } = await import("../src/state/store.js");
const { bindUserMenu, userMenuHtml } = await import("../src/components/userMenu.js");

const key = (el, k) => el.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }));

let cleanup;
beforeEach(() => {
  setAuth("token", { id: "1", name: "Ana María Contadora", email: "ana@example.com", role: "accountant" });
  document.body.innerHTML = `<div id="toast-root"></div><aside>${userMenuHtml()}</aside><button id="fuera">Fuera</button>`;
  cleanup = bindUserMenu(document.body);
});
afterEach(() => {
  cleanup();
  clearAuth();
  document.body.innerHTML = "";
});

const button = () => document.getElementById("user-menu-button");
const popup = () => document.querySelector(".user-menu__popup");
const items = () => [...document.querySelectorAll('[role="menuitem"]')];

describe("menú de usuario", () => {
  it("muestra nombre, rol y correo; el botón declara aria-haspopup y aria-expanded", () => {
    expect(button().getAttribute("aria-haspopup")).toBe("menu");
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.querySelector(".user-menu__avatar").textContent).toBe("AM");
    button().click();
    const header = document.querySelector(".user-menu__header").textContent;
    expect(header).toContain("Ana María Contadora");
    expect(header).toContain("Contador/a");
    expect(header).toContain("ana@example.com");
    expect(items().map((i) => i.textContent)).toEqual(["Mi perfil", "Salir"]);
  });

  it("al abrir, el foco va a la primera opción; ↓/↑ recorren con vuelta; Inicio/Fin", () => {
    button().click();
    expect(button().getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement, "ArrowDown");
    expect(document.activeElement).toBe(items()[1]);
    key(document.activeElement, "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement, "ArrowUp");
    expect(document.activeElement).toBe(items()[1]);
    key(document.activeElement, "Home");
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement, "End");
    expect(document.activeElement).toBe(items()[1]);
  });

  it("↓ en el botón abre en la primera opción y ↑ en la última", () => {
    key(button(), "ArrowDown");
    expect(document.activeElement).toBe(items()[0]);
    key(document.activeElement, "Escape");
    key(button(), "ArrowUp");
    expect(document.activeElement).toBe(items()[1]);
  });

  it("Escape cierra y devuelve el foco al botón que lo abrió", () => {
    button().click();
    key(document.activeElement, "Escape");
    expect(popup().hidden).toBe(true);
    expect(button().getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(button());
  });

  it("un clic fuera lo cierra (sin robar el foco a donde se hizo clic)", () => {
    button().click();
    const outside = document.getElementById("fuera");
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(popup().hidden).toBe(true);
    expect(document.activeElement).not.toBe(button());
  });

  it("un clic dentro del menú no lo cierra", () => {
    button().click();
    document.querySelector(".user-menu__header").dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    expect(popup().hidden).toBe(false);
  });

  it("Tab cierra el menú", () => {
    button().click();
    key(document.activeElement, "Tab");
    expect(popup().hidden).toBe(true);
  });

  it("'Mi perfil' lleva a #/profile y 'Salir' cierra la sesión con confirmación", async () => {
    expect(items()[0].getAttribute("href")).toBe("#/profile");
    button().click();
    items()[1].click();
    await Promise.resolve();
    await Promise.resolve();
    expect(logout).toHaveBeenCalled();
    expect(document.querySelector(".toast").textContent).toBe("Cerraste sesión.");
  });

  it("la cabecera usa los datos más recientes al abrir (el correo llega tras recuperar la sesión)", () => {
    setAuth("token", { id: "1", name: "Ana María Contadora", email: "nuevo@example.com", role: "accountant" });
    button().click();
    expect(document.querySelector(".user-menu__header").textContent).toContain("nuevo@example.com");
  });

  it("escapa el nombre", () => {
    setAuth("token", { id: "2", name: "<img src=x onerror=alert(1)>", role: "assistant" });
    document.body.innerHTML = userMenuHtml();
    expect(document.querySelector("img")).toBeNull();
  });
});

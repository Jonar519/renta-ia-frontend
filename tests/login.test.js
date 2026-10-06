import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Login rediseñado (B10): formulario con el único <h1>, composición de
 * marca "papel contable" sin cifras y "Mostrar contraseña". En Chrome real (axe en ambos temas, móvil): e2e/login.spec.js.
 */

vi.mock("../src/api/auth.api.js", () => ({ authApi: { login: vi.fn(), loginMfa: vi.fn() } }));
vi.mock("../src/auth/session.js", () => ({ startSession: vi.fn(), logout: vi.fn() }));

const { authApi } = await import("../src/api/auth.api.js");
const { startSession } = await import("../src/auth/session.js");
const { renderLogin } = await import("../src/views/login.view.js");

const app = () => document.getElementById("app");

beforeEach(() => {
  document.body.innerHTML = `<div id="toast-root"></div><div id="app"></div>`;
  renderLogin(app());
});
afterEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
});

describe("login (B10)", () => {
  it("un solo <h1>, en el formulario; el formulario va antes que la composición de marca", () => {
    const headings = app().querySelectorAll("h1");
    expect(headings).toHaveLength(1);
    expect(headings[0].textContent).toBe("Inicia sesión");
    const form = app().querySelector("#login-form");
    const hero = app().querySelector(".login__hero");
    expect(form.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("composición de marca: nombre, lema y un índice de tres líneas, sin ninguna cifra", () => {
    const hero = app().querySelector(".login__hero");
    expect(hero.querySelector(".login__wordmark").textContent).toBe("Renta IA");
    expect(hero.querySelector(".login__motto").textContent).toBe("La IA lee. Tú decides.");
    // Como lo lee un lector de pantalla: "término: descripción" (los puntos guía son decorativos).
    expect([...hero.querySelectorAll(".login__index li")].map((li) => li.textContent)).toEqual([
      "Lee tus soportes:extrae las cifras de certificados, extractos y facturas.",
      "Te avisa:vencimientos e inconsistencias entre documentos.",
      "Tú decides:las cifras y los resúmenes son orientativos; los verificas antes de declarar.",
    ]);
    for (const leader of hero.querySelectorAll(".login__leader"))
      expect(leader.getAttribute("aria-hidden")).toBe("true");
    expect(hero.textContent).not.toMatch(/\d/);
  });

  it("nada del flujo de ejemplo ni del violeta de IA en el login", () => {
    expect(app().querySelector("figure, .badge, [class*='ai']")).toBeNull();
    expect(app().textContent).not.toMatch(/Ejemplo|DIAN/);
  });

  it("campos con etiqueta y 'Mostrar contraseña' (aria-pressed, nombre fijo)", () => {
    const email = app().querySelector("#login-email");
    expect(app().querySelector(`label[for="${email.id}"]`).textContent).toBe("Correo");
    expect(email.autocomplete).toBe("email");
    const password = app().querySelector("#login-password");
    expect(password.autocomplete).toBe("current-password");
    const toggle = app().querySelector(".password-field__toggle");
    toggle.click();
    expect([password.type, toggle.getAttribute("aria-pressed")]).toEqual(["text", "true"]);
    expect(toggle.textContent.replace(/\s+/g, " ").trim()).toBe("Mostrar contraseña");
  });

  it("sin estilos en línea (la CSP los bloquea)", () => {
    expect(app().querySelector("[style]")).toBeNull();
  });

  it("enviar inicia sesión con los datos del formulario", async () => {
    authApi.login.mockResolvedValue({ accessToken: "t", user: { id: "1", name: "Ana", role: "accountant" } });
    app().querySelector("#login-email").value = "ana@example.com";
    app().querySelector("#login-password").value = "una contraseña";
    app()
      .querySelector("#login-form")
      .dispatchEvent(new Event("submit", { cancelable: true }));
    await new Promise((r) => setTimeout(r, 0));
    expect(authApi.login).toHaveBeenCalledWith({ email: "ana@example.com", password: "una contraseña" });
    expect(startSession).toHaveBeenCalled();
  });
});

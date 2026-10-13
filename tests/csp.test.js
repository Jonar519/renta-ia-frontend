// @vitest-environment node
import { describe, expect, it } from "vitest";
import { buildCsp } from "../vite.config.js";

/** Content-Security-Policy del build (vite.config.js). Entorno node: importa la config de Vite. */
describe("CSP", () => {
  const csp = buildCsp("http://localhost:4000");

  it("sin estilos ni scripts en línea, sin objetos ni marcos", () => {
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("style-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).not.toContain("unsafe-");
  });

  it("imágenes: propias, data: (QR de MFA) y blob: (foto de perfil, B12); nada externo", () => {
    expect(csp).toContain("img-src 'self' data: blob:;");
  });

  it("solo habla con la API configurada (HTTP y WebSocket)", () => {
    expect(csp).toContain("connect-src 'self' http://localhost:4000 ws://localhost:4000");
  });
});

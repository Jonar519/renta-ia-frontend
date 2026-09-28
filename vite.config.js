import { defineConfig } from "vitest/config";

// Fuentes que se usan en la primera pintura (texto del login y títulos):
// se precargan para que no esperen a que el navegador descubra el CSS.
const PRELOAD_FONTS = [/inter-latin-wght-normal-[\w-]+\.woff2$/, /source-serif-4-latin-600-normal-[\w-]+\.woff2$/];

/**
 * Inserta <link rel="preload" as="font"> con el nombre FINAL (con hash) de
 * cada fuente. Solo en el build: en desarrollo Vite sirve los archivos sin hash.
 */
function preloadFonts() {
  return {
    name: "renta-ia:preload-fonts",
    transformIndexHtml: {
      order: "post",
      handler(_html, ctx) {
        if (!ctx.bundle) return [];
        return Object.keys(ctx.bundle)
          .filter((file) => PRELOAD_FONTS.some((regex) => regex.test(file)))
          .map((file) => ({
            tag: "link",
            attrs: { rel: "preload", href: `/${file}`, as: "font", type: "font/woff2", crossorigin: "" },
            injectTo: "head",
          }));
      },
    },
  };
}

export default defineConfig({
  plugins: [preloadFonts()],
  server: {
    port: 5173,
  },
  build: {
    // Las fuentes nunca se incrustan como base64 dentro del CSS (bloquearían
    // su descarga y no se podrían precargar ni cachear aparte).
    assetsInlineLimit: (file) => (file.endsWith(".woff2") ? false : undefined),
  },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.js"],
    restoreMocks: true,
  },
});

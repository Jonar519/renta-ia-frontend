import js from "@eslint/js";
import prettier from "eslint-config-prettier";
import globals from "globals";

export default [
  { ignores: ["dist/", "node_modules/", "coverage/"] },
  js.configs.recommended,
  {
    languageOptions: { ecmaVersion: 2022, sourceType: "module", globals: globals.browser },
    rules: {
      "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
    },
  },
  { files: ["public/service-worker.js"], languageOptions: { sourceType: "script", globals: globals.serviceworker } },
  { files: ["src/workers/**/*.js"], languageOptions: { globals: globals.worker } },
  { files: ["tests/**/*.js", "*.config.js"], languageOptions: { globals: { ...globals.node, ...globals.browser } } },
  // Desactiva reglas de estilo que chocan con Prettier (debe ir al final).
  prettier,
];

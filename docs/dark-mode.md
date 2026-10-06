# Tema oscuro, tipografía de datos y movimiento (Fase 5, bloque B1)

Evolución del sistema de diseño existente (ver `design-tokens-audit.md`), no
un reemplazo: mismos primitivos, una capa semántica nueva y un tema oscuro
derivado de esos mismos primitivos.

## 1. Regla de tema

- La app sigue **solo** el tema del sistema operativo: `@media (prefers-color-scheme: dark)`
  en `src/styles/tokens.css`. **CSS puro**: ningún JavaScript consulta, decide ni guarda el tema.
- **Cambio en vivo**: si el usuario cambia el tema del sistema con la app abierta, el
  navegador reevalúa la media query y los colores cambian sin recargar.
- **Sin selector manual** en ninguna pantalla y **sin columna** de preferencia de tema en
  la base (no existía ninguna; ver la auditoría, hallazgo H9).
- `color-scheme: light dark` (en `:root` y como `<meta>` en `index.html` y `offline.html`):
  los controles nativos (barras de desplazamiento, autocompletado) siguen el tema y el
  lienzo inicial, antes de cargar el CSS, no destella en blanco.

Cómo se garantiza:

| Garantía                                                                                     | Prueba                                            |
| -------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| Ningún JS lee `prefers-color-scheme`, usa `data-theme`, ni guarda el tema en almacenamiento  | `tests/theme.test.js`                             |
| No hay selectores de tema manual (`[data-theme]`, `.dark`)                                   | `tests/theme.test.js`                             |
| El tema oscuro vive solo en `tokens.css`; cada token semántico claro tiene su versión oscura | `tests/theme.test.js`                             |
| Los componentes no usan colores literales ni primitivos que cambian con el tema              | `tests/theme.test.js`                             |
| Ninguna columna de la base guarda un tema                                                    | backend `tests/integration/database.test.ts`      |
| Cambio en vivo sin recarga, sin controles de tema, axe en ambos temas                        | `e2e/theme.spec.js` (Chrome real)                 |
| axe en claro **y** oscuro en cada pantalla del flujo crítico                                 | `e2e/a11y.js` (usado por `critical-flow.spec.js`) |

## 2. Arquitectura de tokens

1. **Primitivos** (`--color-*`): la paleta "Midnight Executive". Los únicos nuevos son
   `navy-950` y `navy-800` (ya existían como literales del degradado del login),
   `slate-200` y `neutral-100` (literales del sidebar y del badge neutro), `white`, y la
   familia **violeta** para el contenido de IA.
2. **Semánticos** (`--bg-*`, `--text-*`, `--border-*`, `--tone-*`, …): qué significa cada
   color. Los componentes usan solo esta capa, salvo una lista explícita de primitivos que
   no cambian con el tema (texto blanco sobre rellenos oscuros, degradado del login,
   sidebar, toasts de éxito y error).
3. **Tema oscuro**: redefine solo la capa semántica, derivándola de los primitivos con
   `color-mix(in srgb, …)`. La derivación está en el CSS y no en una tabla aparte, y el
   script de contraste la evalúa igual que el navegador.

Reglas de derivación del tema oscuro:

- Fondos: `navy-950` (app) y `navy-900` (superficies). Son los mismos tonos del sidebar y
  del login.
- Texto: los fondos claros (`bg`, `slate-200`, `white`) pasan a ser el texto.
- Badges: fondo = tono fuerte (700/800) al 50 % sobre `navy-900`; texto = tono claro (100).
- Enlace, foco y pestaña activa: `navy-500` aclarado con 55 % de blanco.
- Acción principal: `navy-500` (en el claro es `navy-700`).

### Tokens nuevos aprobados en B0

- **`--border-control`** (hallazgo H1): contorno de los inputs. Antes usaban
  `--color-border` (1.26:1, no cumplía WCAG 1.4.11). Ahora mide **3.45:1** en claro y
  **3.64:1** en oscuro. `--border-subtle` queda solo para separadores decorativos.
- **`--tone-ai-*` y `--ai-accent`** (hallazgo H2): contenido producido por IA (burbuja del
  asistente en el chat, resumen ejecutivo y, desde B16, el badge
  "Extraído por IA · sin revisar"). El ámbar queda solo para "advertencia". Se eligió el
  violeta porque azul, verde, rojo y ámbar ya significan info, éxito, error y advertencia.

### Derivación completa

| Token                | Claro                                                               | Oscuro                                                                   |
| -------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `--bg-app`           | `var(--color-bg)`                                                   | `var(--color-navy-950)`                                                  |
| `--bg-surface`       | `var(--color-surface)`                                              | `var(--color-navy-900)`                                                  |
| `--text`             | `var(--color-ink-900)`                                              | `var(--color-bg)`                                                        |
| `--text-strong`      | `var(--color-navy-900)`                                             | `var(--color-white)`                                                     |
| `--text-muted`       | `var(--color-ink-500)`                                              | `var(--color-slate-200)`                                                 |
| `--text-link`        | `var(--color-navy-500)`                                             | `color-mix(in srgb, var(--color-white) 55%, var(--color-navy-500))`      |
| `--focus-ring`       | `var(--color-navy-500)`                                             | `color-mix(in srgb, var(--color-white) 55%, var(--color-navy-500))`      |
| `--border-subtle`    | `var(--color-border)`                                               | `var(--color-navy-800)`                                                  |
| `--border-control`   | `color-mix(in srgb, var(--color-ink-500) 70%, var(--color-border))` | `color-mix(in srgb, var(--color-slate-200) 50%, var(--color-navy-900))`  |
| `--action-bg`        | `var(--color-navy-700)`                                             | `var(--color-navy-500)`                                                  |
| `--accent-indicator` | `var(--color-navy-700)`                                             | `color-mix(in srgb, var(--color-white) 55%, var(--color-navy-500))`      |
| `--action-bg-hover`  | `var(--color-navy-900)`                                             | `var(--color-navy-700)`                                                  |
| `--toast-bg`         | `var(--color-navy-900)`                                             | `var(--color-navy-700)`                                                  |
| `--sidebar-bg`       | `var(--color-navy-900)`                                             | `var(--color-navy-950)`                                                  |
| `--sidebar-border`   | `var(--color-navy-900)`                                             | `var(--color-navy-800)`                                                  |
| `--tone-neutral-bg`  | `var(--color-neutral-100)`                                          | `var(--color-navy-800)`                                                  |
| `--tone-neutral-fg`  | `var(--color-ink-500)`                                              | `var(--color-slate-200)`                                                 |
| `--tone-info-bg`     | `var(--color-blue-100)`                                             | `color-mix(in srgb, var(--color-blue-700) 50%, var(--color-navy-900))`   |
| `--tone-info-fg`     | `var(--color-blue-700)`                                             | `var(--color-blue-100)`                                                  |
| `--tone-success-bg`  | `var(--color-green-100)`                                            | `color-mix(in srgb, var(--color-green-800) 50%, var(--color-navy-900))`  |
| `--tone-success-fg`  | `var(--color-green-800)`                                            | `var(--color-green-100)`                                                 |
| `--tone-warning-bg`  | `var(--color-amber-100)`                                            | `color-mix(in srgb, var(--color-amber-800) 50%, var(--color-navy-900))`  |
| `--tone-warning-fg`  | `var(--color-amber-800)`                                            | `var(--color-amber-100)`                                                 |
| `--tone-error-bg`    | `var(--color-red-100)`                                              | `color-mix(in srgb, var(--color-red-700) 50%, var(--color-navy-900))`    |
| `--tone-error-fg`    | `var(--color-red-700)`                                              | `var(--color-red-100)`                                                   |
| `--tone-ai-bg`       | `var(--color-violet-100)`                                           | `color-mix(in srgb, var(--color-violet-700) 50%, var(--color-navy-900))` |
| `--tone-ai-fg`       | `var(--color-violet-700)`                                           | `var(--color-violet-100)`                                                |
| `--ai-accent`        | `var(--color-violet-600)`                                           | `color-mix(in srgb, var(--color-white) 50%, var(--color-violet-600))`    |
| `--shadow-sm`        | `0 1px 2px rgba(22, 35, 58, 0.06)`                                  | `0 1px 2px rgba(0, 0, 0, 0.4)`                                           |
| `--shadow-lg`        | `0 24px 48px rgba(10, 16, 28, 0.35)`                                | `0 24px 48px rgba(0, 0, 0, 0.55)`                                        |

## 3. Contraste AA medido

Generado con `node scripts/contrast.mjs` a partir de `tokens.css` y
`offline.html`. `tests/contrast.test.js` falla si algún par baja del mínimo:
**4.5:1** para texto normal (WCAG 1.4.3) y **3:1** para elementos gráficos y
límites de controles (WCAG 1.4.11). Resultado: **74 de 74 pares cumplen** (37 por tema).

### Tema oscuro

| Par                                            | Color     | Fondo     | Medido  | Mínimo exigido | Resultado |
| ---------------------------------------------- | --------- | --------- | ------- | -------------- | --------- |
| Texto principal / fondo de la app              | `#f4f6f8` | `#0f1a2c` | 16.09:1 | 4.5:1          | Cumple    |
| Texto principal / superficie (paneles, inputs) | `#f4f6f8` | `#16233a` | 14.51:1 | 4.5:1          | Cumple    |
| Texto secundario / fondo de la app             | `#c7d2e0` | `#0f1a2c` | 11.39:1 | 4.5:1          | Cumple    |
| Texto secundario / superficie                  | `#c7d2e0` | `#16233a` | 10.27:1 | 4.5:1          | Cumple    |
| Títulos / fondo de la app                      | `#ffffff` | `#0f1a2c` | 17.44:1 | 4.5:1          | Cumple    |
| Títulos / superficie                           | `#ffffff` | `#16233a` | 15.72:1 | 4.5:1          | Cumple    |
| Enlace / fondo de la app                       | `#a1b6ca` | `#0f1a2c` | 8.33:1  | 4.5:1          | Cumple    |
| Enlace / superficie                            | `#a1b6ca` | `#16233a` | 7.51:1  | 4.5:1          | Cumple    |
| Error de formulario / superficie               | `#f5d6d6` | `#16233a` | 11.58:1 | 4.5:1          | Cumple    |
| Botón primario: texto / fondo                  | `#ffffff` | `#2e5c8a` | 6.97:1  | 4.5:1          | Cumple    |
| Botón primario (hover): texto / fondo          | `#ffffff` | `#1f3b57` | 11.53:1 | 4.5:1          | Cumple    |
| Chat, burbuja del usuario: texto / fondo       | `#ffffff` | `#2e5c8a` | 6.97:1  | 4.5:1          | Cumple    |
| Chat, burbuja de la IA: texto / fondo IA       | `#f4f6f8` | `#393163` | 10.83:1 | 4.5:1          | Cumple    |
| Resumen IA: texto / fondo IA                   | `#f4f6f8` | `#393163` | 10.83:1 | 4.5:1          | Cumple    |
| Badge neutro                                   | `#c7d2e0` | `#24365a` | 7.84:1  | 4.5:1          | Cumple    |
| Badge info (Procesando, Abierta)               | `#e4eef7` | `#1a3f63` | 9.29:1  | 4.5:1          | Cumple    |
| Badge éxito (Procesado, Resuelta)              | `#eafaf1` | `#184b3d` | 9.21:1  | 4.5:1          | Cumple    |
| Badge advertencia / banner sin conexión        | `#fcf3e7` | `#533f21` | 9.12:1  | 4.5:1          | Cumple    |
| Badge error / burbuja de error                 | `#f5d6d6` | `#552a30` | 8.79:1  | 4.5:1          | Cumple    |
| Badge IA                                       | `#f1ecf8` | `#393163` | 10.11:1 | 4.5:1          | Cumple    |
| Toast informativo                              | `#ffffff` | `#1f3b57` | 11.53:1 | 4.5:1          | Cumple    |
| Toast de éxito                                 | `#ffffff` | `#1e8449` | 4.72:1  | 4.5:1          | Cumple    |
| Toast de error                                 | `#ffffff` | `#943126` | 7.70:1  | 4.5:1          | Cumple    |
| Sidebar: enlace / fondo                        | `#c7d2e0` | `#0f1a2c` | 11.39:1 | 4.5:1          | Cumple    |
| Sidebar: enlace activo / fondo + 12 % blanco   | `#ffffff` | `#2c3545` | 12.27:1 | 4.5:1          | Cumple    |
| Skip-link: texto / fondo                       | `#ffffff` | `#16233a` | 15.72:1 | 4.5:1          | Cumple    |
| Anillo de foco / superficie                    | `#a1b6ca` | `#16233a` | 7.51:1  | 3:1            | Cumple    |
| Anillo de foco / fondo de la app               | `#a1b6ca` | `#0f1a2c` | 8.33:1  | 3:1            | Cumple    |
| Contorno de input / superficie                 | `#6f7b8d` | `#16233a` | 3.64:1  | 3:1            | Cumple    |
| Contorno de input / fondo de la app            | `#6f7b8d` | `#0f1a2c` | 4.04:1  | 3:1            | Cumple    |
| Pestaña activa (subrayado) / fondo de la app   | `#a1b6ca` | `#0f1a2c` | 8.33:1  | 3:1            | Cumple    |
| Pestaña activa (subrayado) / superficie        | `#a1b6ca` | `#16233a` | 7.51:1  | 3:1            | Cumple    |
| Filete del resumen IA / superficie             | `#bdadd8` | `#16233a` | 7.57:1  | 3:1            | Cumple    |
| offline.html: título / fondo                   | `#ffffff` | `#16233a` | 15.72:1 | 4.5:1          | Cumple    |
| offline.html: texto / fondo                    | `#c7d2e0` | `#16233a` | 10.27:1 | 4.5:1          | Cumple    |
| offline.html: botón texto / fondo              | `#16233a` | `#ffffff` | 15.72:1 | 4.5:1          | Cumple    |
| offline.html: foco / fondo                     | `#b9770e` | `#16233a` | 4.27:1  | 3:1            | Cumple    |

### Tema claro

| Par                                            | Color     | Fondo     | Medido  | Mínimo exigido | Resultado |
| ---------------------------------------------- | --------- | --------- | ------- | -------------- | --------- |
| Texto principal / fondo de la app              | `#1f2a38` | `#f4f6f8` | 13.40:1 | 4.5:1          | Cumple    |
| Texto principal / superficie (paneles, inputs) | `#1f2a38` | `#ffffff` | 14.52:1 | 4.5:1          | Cumple    |
| Texto secundario / fondo de la app             | `#5b6472` | `#f4f6f8` | 5.52:1  | 4.5:1          | Cumple    |
| Texto secundario / superficie                  | `#5b6472` | `#ffffff` | 5.98:1  | 4.5:1          | Cumple    |
| Títulos / fondo de la app                      | `#16233a` | `#f4f6f8` | 14.51:1 | 4.5:1          | Cumple    |
| Títulos / superficie                           | `#16233a` | `#ffffff` | 15.72:1 | 4.5:1          | Cumple    |
| Enlace / fondo de la app                       | `#2e5c8a` | `#f4f6f8` | 6.43:1  | 4.5:1          | Cumple    |
| Enlace / superficie                            | `#2e5c8a` | `#ffffff` | 6.97:1  | 4.5:1          | Cumple    |
| Error de formulario / superficie               | `#943126` | `#ffffff` | 7.70:1  | 4.5:1          | Cumple    |
| Botón primario: texto / fondo                  | `#ffffff` | `#1f3b57` | 11.53:1 | 4.5:1          | Cumple    |
| Botón primario (hover): texto / fondo          | `#ffffff` | `#16233a` | 15.72:1 | 4.5:1          | Cumple    |
| Chat, burbuja del usuario: texto / fondo       | `#ffffff` | `#1f3b57` | 11.53:1 | 4.5:1          | Cumple    |
| Chat, burbuja de la IA: texto / fondo IA       | `#1f2a38` | `#f1ecf8` | 12.51:1 | 4.5:1          | Cumple    |
| Resumen IA: texto / fondo IA                   | `#1f2a38` | `#f1ecf8` | 12.51:1 | 4.5:1          | Cumple    |
| Badge neutro                                   | `#5b6472` | `#eef0f3` | 5.24:1  | 4.5:1          | Cumple    |
| Badge info (Procesando, Abierta)               | `#1d5a8c` | `#e4eef7` | 6.18:1  | 4.5:1          | Cumple    |
| Badge éxito (Procesado, Resuelta)              | `#197340` | `#eafaf1` | 5.45:1  | 4.5:1          | Cumple    |
| Badge advertencia / banner sin conexión        | `#8f5b08` | `#fcf3e7` | 5.21:1  | 4.5:1          | Cumple    |
| Badge error / burbuja de error                 | `#943126` | `#f5d6d6` | 5.67:1  | 4.5:1          | Cumple    |
| Badge IA                                       | `#5b3f8c` | `#f1ecf8` | 7.14:1  | 4.5:1          | Cumple    |
| Toast informativo                              | `#ffffff` | `#16233a` | 15.72:1 | 4.5:1          | Cumple    |
| Toast de éxito                                 | `#ffffff` | `#1e8449` | 4.72:1  | 4.5:1          | Cumple    |
| Toast de error                                 | `#ffffff` | `#943126` | 7.70:1  | 4.5:1          | Cumple    |
| Sidebar: enlace / fondo                        | `#c7d2e0` | `#16233a` | 10.27:1 | 4.5:1          | Cumple    |
| Sidebar: enlace activo / fondo + 12 % blanco   | `#ffffff` | `#323d52` | 10.87:1 | 4.5:1          | Cumple    |
| Skip-link: texto / fondo                       | `#ffffff` | `#16233a` | 15.72:1 | 4.5:1          | Cumple    |
| Anillo de foco / superficie                    | `#2e5c8a` | `#ffffff` | 6.97:1  | 3:1            | Cumple    |
| Anillo de foco / fondo de la app               | `#2e5c8a` | `#f4f6f8` | 6.43:1  | 3:1            | Cumple    |
| Contorno de input / superficie                 | `#848b96` | `#ffffff` | 3.45:1  | 3:1            | Cumple    |
| Contorno de input / fondo de la app            | `#848b96` | `#f4f6f8` | 3.18:1  | 3:1            | Cumple    |
| Pestaña activa (subrayado) / fondo de la app   | `#1f3b57` | `#f4f6f8` | 10.64:1 | 3:1            | Cumple    |
| Pestaña activa (subrayado) / superficie        | `#1f3b57` | `#ffffff` | 11.53:1 | 3:1            | Cumple    |
| Filete del resumen IA / superficie             | `#7a5bb0` | `#ffffff` | 5.32:1  | 3:1            | Cumple    |
| offline.html: título / fondo                   | `#1f2a38` | `#f4f6f8` | 13.40:1 | 4.5:1          | Cumple    |
| offline.html: texto / fondo                    | `#5b6472` | `#f4f6f8` | 5.52:1  | 4.5:1          | Cumple    |
| offline.html: botón texto / fondo              | `#ffffff` | `#1f3b57` | 11.53:1 | 4.5:1          | Cumple    |
| offline.html: foco / fondo                     | `#b9770e` | `#f4f6f8` | 3.40:1  | 3:1            | Cumple    |

## 4. Tipografía de datos

- **JetBrains Mono 400**, subconjunto latín, autoalojada (`src/styles/fonts.css`) y precargada
  como las otras dos.
- Clase `.num`: montos, fechas, años, números de documento, valores y muestras de Web Vitals.
  `.num--end` alinea los montos a la derecha. Los nombres, descripciones y etiquetas siguen
  en Inter.
- Peso fijo 400 y `font-synthesis: none`: las cifras nunca usan una negrita sintetizada.

| Medición (build de producción)                   | Antes               | Después                  | Presupuesto    |
| ------------------------------------------------ | ------------------- | ------------------------ | -------------- |
| Fuentes (woff2)                                  | 68,15 KB            | **88,82 KB** (+20,67 KB) | 75 → **95 KB** |
| Variante variable de JetBrains Mono (descartada) | —                   | 39,46 KB                 | no cabría      |
| CSS total (gzip)                                 | 3,15 KB             | 3,80 KB                  | 4 KB           |
| JS de entrada (gzip)                             | 4,00 KB (al límite) | **3,62 KB**              | 4 KB           |

El JS de entrada bajó porque el módulo de tiempo real (WebSocket) ahora se descarga recién
con la primera sesión (`src/main.js`): el login no lo usa. Esto deja margen para el guard
de ruta y el menú de B3 (hallazgo H6).

## 5. Movimiento

- **Única animación con movimiento continuo** (decisión D4): el indicador
  "procesando con IA" (clase `.ai-processing`, se construye en B2). Representa trabajo real
  en curso. Hoy no existe ninguna otra: no hay ningún `@keyframes`.
- **Todo lo demás**: transiciones cortas disparadas por el usuario (botón 150 ms, toast
  200 ms) y, desde B16, una micro-interacción de una sola vez para el badge de IA. Los
  skeletons de B2 serán estáticos, sin shimmer.
- **`prefers-reduced-motion: reduce`** (`base.css`): anula duraciones y además fija
  `animation-iteration-count: 1`. Antes faltaba: una animación infinita de 0,001 ms habría
  seguido en bucle.
- `tests/motion.test.js` falla si aparece otra regla con `infinite`, una animación en bucle
  desde JavaScript, o si se debilita el bloque de movimiento reducido.

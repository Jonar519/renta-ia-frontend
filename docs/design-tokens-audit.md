# Auditoría del sistema de diseño (estado al inicio de la Fase 5)

Qué significa **realmente** cada token y color en el CSS actual, verificado
en el código (`src/styles/*.css`, `src/views/**`, `public/`), no en su nombre.
Es la base para evolucionar el sistema (modo oscuro, tipografía de datos,
estados) sin inventar una paleta nueva. Nada de este documento cambia código.

Fuentes revisadas: `tokens.css` (43 líneas), `base.css`, `layout.css`,
`components.css` (537 líneas), `fonts.css`, `views/clientDetail/labels.js`
(mapeo estado → tono), `public/offline.html`, `public/favicon.svg`.

## 1. Color: significado real por uso

Usos = número de `var(--token)` en `src/`.

### Superficies y texto

| Token             | Valor     | Usos   | Significado real (dónde se usa)                                                                                                                   |
| ----------------- | --------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-bg`      | `#f4f6f8` | 2      | Fondo de la aplicación (`body`) y _hover_ del botón fantasma                                                                                      |
| `--color-surface` | `#ffffff` | 3      | Fondo de contenedores: `.panel`, `.auth-card`, `.update-banner`                                                                                   |
| `--color-ink-900` | `#1f2a38` | 5      | Texto principal del cuerpo, celdas destacadas, inputs, burbuja de la IA                                                                           |
| `--color-ink-500` | `#5b6472` | **17** | Texto secundario: etiquetas de formulario, cabeceras de tabla, notas, pestañas inactivas, estados vacíos, badge neutro. Es el token más usado     |
| `--color-border`  | `#e2e5ea` | 11     | **Dos papeles distintos**: separador decorativo (tablas, pestañas, paneles) **y** contorno de inputs (que identifica un control). Ver hallazgo H1 |

### Marca (navy)

| Token              | Valor     | Usos | Significado real                                                                                                                         |
| ------------------ | --------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-navy-900` | `#16233a` | 8    | Identidad/autoridad: títulos `h1-h3`, sidebar, fondo del login, toast informativo, _hover_ del botón primario, pestaña activa, skip-link |
| `--color-navy-700` | `#1f3b57` | 4    | **Acción principal**: `.btn--primary`, burbuja del usuario en el chat, subrayado de la pestaña activa                                    |
| `--color-navy-500` | `#2e5c8a` | 3    | **Interactivo/foco**: enlaces, anillo `:focus-visible`, borde de input enfocado                                                          |

### Ámbar: tiene DOS significados (hallazgo H2)

| Token               | Valor     | Usos | Significado real                                                                                                                                                                 |
| ------------------- | --------- | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--color-amber-100` | `#fcf3e7` | 4    | (a) fondo de **advertencia**: `.badge--warning`, banner sin conexión; (b) fondo de **contenido redactado por IA**: burbuja del asistente en el chat, texto del resumen ejecutivo |
| `--color-amber-800` | `#8f5b08` | 2    | Texto sobre amber-100 en advertencias (badge, banner offline)                                                                                                                    |
| `--color-amber-600` | `#b9770e` | 1    | Acento gráfico: filete izquierdo del resumen generado por IA (y en `offline.html`/favicon como acento de marca)                                                                  |

### Estados semánticos

| Token                        | Valor                 | Usos  | Significado real                                                                                                                  |
| ---------------------------- | --------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------- |
| `--color-green-700`          | `#1e8449`             | 1     | Fondo del toast de éxito                                                                                                          |
| `--color-green-100` / `-800` | `#eafaf1` / `#197340` | 1 / 1 | Badge de éxito: documento "Procesado", alerta "Resuelta", Web Vital "Bueno"                                                       |
| `--color-red-700`            | `#943126`             | 5     | Error y gravedad máxima: toast de error, errores de formulario, estado vacío con error, badge de error, burbuja de error del chat |
| `--color-red-100`            | `#f5d6d6`             | 2     | Fondo de badge de error y burbuja de error                                                                                        |
| `--color-blue-100` / `-700`  | `#e4eef7` / `#1d5a8c` | 1 / 1 | Badge "info": documento **Procesando**, alerta **Abierta**, gravedad **Media**                                                    |

Mapeo estado → tono (`labels.js`):

| Dominio             | neutral | info (azul) | success (verde) | warning (ámbar)            | error (rojo)      |
| ------------------- | ------- | ----------- | --------------- | -------------------------- | ----------------- |
| Gravedad de alerta  | Baja    | Media       | —               | Alta                       | Crítica           |
| Estado de alerta    | Vista   | Abierta     | Resuelta        | —                          | —                 |
| Estado de documento | En cola | Procesando  | Procesado       | Procesado con advertencias | Error al procesar |

### Colores fuera de los tokens (hard-coded)

| Valor                            | Dónde                                                        | Papel                                          | Problema para el modo oscuro                                         |
| -------------------------------- | ------------------------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------- |
| `#ffffff` / `#fff`               | botón primario, toasts, sidebar, skip-link, chat del usuario | Texto sobre fondo oscuro                       | Correcto en ambos temas, pero conviene nombrarlo (`--color-on-dark`) |
| `#ffffff`                        | `background` de inputs (`components.css:151`)                | Fondo de campo                                 | **Se quedaría blanco en modo oscuro**: debe ser `--color-surface`    |
| `#eef0f3`                        | `.badge--neutral`                                            | Fondo neutro                                   | Sin token: no se puede invertir                                      |
| `#c7d2e0`                        | sidebar (texto de enlaces y botón)                           | Texto secundario sobre navy                    | Sin token                                                            |
| `rgba(255,255,255,.06/.12/.2)`   | sidebar (hover, activo, borde)                               | Superposiciones sobre navy                     | Correctas en ambos temas (el sidebar ya es oscuro)                   |
| `#24365a`, `#0f1a2c`             | degradado de `.auth-screen`                                  | Variantes de navy-900                          | Sin token                                                            |
| (ninguno)                        | `.chat-form input`                                           | No define fondo ni color: usa el del navegador | En oscuro quedaría blanco con texto heredado                         |
| `#16233a`, `#c7d2e0`, `#b9770e`… | `public/offline.html`, `favicon.svg`                         | Copia literal de la paleta                     | Página estática aparte: necesita su propio `@media`                  |

## 2. Contraste actual (tema claro), medido

Fórmula de luminancia relativa de WCAG 2.x. Script: el mismo que se usará
para la tabla del modo oscuro en el bloque B1.

| Par (texto / fondo)                                   | Medido     | Mínimo  | Resultado      |
| ----------------------------------------------------- | ---------- | ------- | -------------- |
| Texto principal / fondo app                           | 13.40:1    | 4.5:1   | Cumple         |
| Texto principal / superficie                          | 14.52:1    | 4.5:1   | Cumple         |
| Texto secundario (ink-500) / superficie               | 5.98:1     | 4.5:1   | Cumple         |
| Texto secundario / fondo app                          | 5.52:1     | 4.5:1   | Cumple         |
| Títulos (navy-900) / superficie                       | 15.72:1    | 4.5:1   | Cumple         |
| Enlaces (navy-500) / superficie                       | 6.97:1     | 4.5:1   | Cumple         |
| Enlaces / fondo app                                   | 6.43:1     | 4.5:1   | Cumple         |
| Botón primario: blanco / navy-700                     | 11.53:1    | 4.5:1   | Cumple         |
| Toast base: blanco / navy-900                         | 15.72:1    | 4.5:1   | Cumple         |
| Toast éxito: blanco / green-700                       | 4.72:1     | 4.5:1   | Cumple (justo) |
| Toast error: blanco / red-700                         | 7.70:1     | 4.5:1   | Cumple         |
| Badge info: blue-700 / blue-100                       | 6.18:1     | 4.5:1   | Cumple         |
| Badge éxito: green-800 / green-100                    | 5.45:1     | 4.5:1   | Cumple         |
| Badge aviso: amber-800 / amber-100                    | 5.21:1     | 4.5:1   | Cumple         |
| Badge error: red-700 / red-100                        | 5.67:1     | 4.5:1   | Cumple         |
| Badge neutro: ink-500 / `#eef0f3`                     | 5.24:1     | 4.5:1   | Cumple         |
| Error de formulario (red-700) / superficie            | 7.70:1     | 4.5:1   | Cumple         |
| Banner sin conexión: amber-800 / amber-100            | 5.21:1     | 4.5:1   | Cumple         |
| Chat IA: ink-900 / amber-100                          | 13.21:1    | 4.5:1   | Cumple         |
| Sidebar: `#c7d2e0` / navy-900                         | 10.27:1    | 4.5:1   | Cumple         |
| Sidebar activo: blanco / navy-900 + 12 % blanco       | 10.91:1    | 4.5:1   | Cumple         |
| Anillo de foco (navy-500) / superficie — gráfico      | 6.97:1     | 3:1     | Cumple         |
| Acento del resumen (amber-600) / superficie — gráfico | 3.68:1     | 3:1     | Cumple         |
| **Contorno de input (border) / superficie — gráfico** | **1.26:1** | **3:1** | **No cumple**  |

## 3. Tipografía

| Token          | Valor                                     | Uso real                                                                |
| -------------- | ----------------------------------------- | ----------------------------------------------------------------------- |
| `--font-serif` | Source Serif 4 600 (autoalojada, 21,5 KB) | Solo `h1-h3` y la marca del sidebar: tono de "documento oficial"        |
| `--font-sans`  | Inter Variable (autoalojada, 48,3 KB)     | Todo lo demás, **incluidas las cifras** (montos, fechas, tablas)        |
| —              | `font-variant-numeric: tabular-nums`      | Solo en `.table--totals`; el resto de cifras usa dígitos proporcionales |

Escala: `--fs-xs` 12 px → `--fs-2xl` 36 px (7 pasos); `--fs-sm` (14 px) es el
tamaño de la interfaz (16 usos). Radios: `sm` 6 px (controles), `md` 10 px
(paneles). Sombras: `sm` en toasts; `lg` reservada para el login y el aviso
de versión ("la sombra se reserva para el login", `components.css`).

## 4. Movimiento

- **No existe ningún `@keyframes` ni `animation`**: hoy no hay ninguna
  animación con movimiento continuo.
- Transiciones: `.btn` (color 150 ms, desplazamiento de 1 px al pulsar,
  50 ms) y `.toast` (opacidad y 8 px, 200 ms).
- `base.css` ya reduce todas las duraciones a ~0 con
  `prefers-reduced-motion: reduce`.

## 5. Hallazgos

| #   | Hallazgo                                                                                                               | Propuesta (bloque)                                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H1  | El contorno de los inputs (`--color-border`) tiene 1.26:1 y no cumple WCAG 1.4.11 (3:1 para los límites de un control) | Separar `--color-border` (decorativo) de un `--color-border-control` ≥ 3:1 (B1)                                                                                     |
| H2  | El ámbar significa a la vez "advertencia" y "redactado por IA"                                                         | Nombrar el uso de la IA con su propio token semántico (derivado del ámbar), distinto de `warning`, antes de crear el badge "Extraído por IA · sin revisar" (B1/B16) |
| H3  | 7 colores fuera de los tokens, incluido el fondo blanco fijo de los inputs                                             | Convertirlos en tokens semánticos para poder derivar el tema oscuro (B1)                                                                                            |
| H4  | Las cifras usan Inter proporcional (salvo los totales)                                                                 | JetBrains Mono para datos tabulares (B1)                                                                                                                            |
| H5  | Presupuesto de fuentes: 68,15 KB de 75 KB. Una sola variante latina de JetBrains Mono (~20 KB) lo excede               | Decidir en B1: subir el presupuesto con justificación medida, o cargarla sin `preload`                                                                              |
| H6  | Presupuesto del JS de entrada: 4,00 KB de 4 KB, al límite                                                              | El guard y el menú (B3) deben ir en chunks diferidos o liberar espacio                                                                                              |
| H7  | `#toast-root` es fijo y sin `pointer-events: none`: tapa los clics en la esquina inferior derecha                      | B2                                                                                                                                                                  |
| H8  | `public/offline.html` duplica la paleta en literales                                                                   | Darle su propio `@media (prefers-color-scheme: dark)` (B1)                                                                                                          |
| H9  | No hay selector de tema, ni columna de preferencia de tema, ni JavaScript que decida el tema                           | Nada que eliminar. B1 agrega un test que impide introducirlos                                                                                                       |

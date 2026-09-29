# Reporte de rendimiento

Todas las cifras de este documento salen de mediciones ejecutadas con los scripts de `perf/` y `scripts/`, y los datos crudos están en `perf/results/`. Donde algo no se midió, se dice.

## 1. Método

|              |                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Máquina      | AMD Ryzen 9 7900 (12 núcleos / 24 hilos), 31,1 GB RAM, Windows 11 Pro                                                                                                                            |
| Navegador    | Chrome 154.0.8037.57, controlado con Playwright 1.63.0 (`channel: "chrome"`)                                                                                                                     |
| CPU          | ralentizada **4×** (`Emulation.setCPUThrottlingRate`, igual que el perfil móvil de Lighthouse)                                                                                                   |
| Red          | **"Fast 4G"** de Chrome DevTools: 9 Mbps de bajada, 1,5 Mbps de subida, 60 ms de latencia                                                                                                        |
| Viewport     | 1280 × 800                                                                                                                                                                                       |
| Caché        | fría: contexto de navegador nuevo en cada corrida, Service Worker bloqueado                                                                                                                      |
| Repeticiones | **5 corridas por escenario; se reporta la mediana** (los valores por corrida están en los JSON)                                                                                                  |
| Build        | producción (`vite build` + `vite preview`), API local con `AI_PROVIDER=mock`                                                                                                                     |
| Datos        | `renta-ia-database/seed/perf/001_heavy_dataset.sql` (sintéticos): 1.004 clientes para la contadora del seed, y un cliente "Carga pesada" con **1.500 documentos, 4.000 conceptos y 300 alertas** |

Escenarios (`perf/measure.mjs`):

- **login**: carga en frío de la pantalla de inicio de sesión.
- **dashboard**: clic en "Entrar" → listado de clientes completo en pantalla.
- **detail**: navegar al cliente "Carga pesada" → tablas completas; luego 3 clics en pestañas (Alertas, Resumen, Documentos) para medir INP.

Métricas: FCP/LCP (Paint Timing / Largest Contentful Paint), CLS con el algoritmo de ventanas de sesión de `web-vitals`, **INP = peor interacción** de Event Timing (con menos de 50 interacciones INP coincide con la peor), tareas largas (`longtask`, > 50 ms) y **TBT = Σ(duración − 50 ms)** de esas tareas, bytes transferidos por tipo según los eventos de red (tamaño codificado real; Resource Timing reporta 0 para recursos de otros orígenes).

Reproducir (cmd.exe, con la API y `vite preview` levantados según el README):

```bat
set PERF_BASE_URL=http://localhost:4173
npm run perf:measure -- --label antes --runs 5
npm run perf:profile -- --label antes
```

## 2. Línea base (ANTES de optimizar)

Medida sobre el commit `b286b6f` (cierre de la Fase 1), el 2026-09-28 a las 03:07 UTC.

### 2.1 Qué bloqueaba el hilo principal

`perf/profile.mjs` graba una traza de Chrome del escenario **detail** y suma el tiempo del hilo principal por tipo de trabajo (`perf/results/profile-antes.json`):

| Tipo de trabajo              |          Durante la carga | Durante los 3 clics en pestañas |
| ---------------------------- | ------------------------: | ------------------------------: |
| Layout                       |                **516 ms** |                    **1.321 ms** |
| Pintado                      |                    115 ms |                          397 ms |
| Recálculo de estilos         |                    208 ms |                          190 ms |
| Parseo de HTML (`innerHTML`) |                    143 ms |                               — |
| JavaScript                   |                     94 ms |                          134 ms |
| Tareas largas                | 60, 106, 734, 385, 716 ms |           83, 229, **1.164 ms** |

Conclusión del perfil: **el problema no era el JavaScript, sino la cantidad de DOM.** El detalle pintaba ~5.500 filas (1.500 documentos + 4.000 conceptos) con `innerHTML` de una sola vez. Al volver a la pestaña "Documentos", el navegador tenía que calcular el layout de todas: una tarea de 1,16 s bloqueaba el clic (INP 1.168 ms).

### 2.2 De dónde venía el CLS (0,165)

La atribución de los `layout-shift` mostró un único desplazamiento grande con dos fuentes:

1. El **sidebar** medía lo mismo que la página, y su botón "Cerrar sesión" (anclado abajo) saltaba cientos de píxeles al cambiar la altura del contenido.
2. El **subtítulo del cliente** aparecía vacío y luego se llenaba, empujando pestañas y paneles 22 px hacia abajo.

### 2.3 Red

- **Fuentes de Google:** 166,7 KB desde dos dominios de terceros (Source Serif 4 **variable, con eje de tamaño óptico: 122 KB**, cuando la app solo usa el peso 600).
- **API sin compresión:** el detalle transfería **2.284,5 KB** de JSON. Con `curl` sobre el cliente pesado, `GET /tax-concepts` pesaba **824.433 bytes**.

## 3. Optimizaciones (cada una atada a un hallazgo)

| Hallazgo medido                             | Cambio                                                                                                                                                                                             | Archivo                                                  |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| Layout de ~5.500 filas                      | Paginación por cursor (50 por página) con "Cargar más"; 100 conceptos iniciales + "Mostrar más"                                                                                                    | backend `utils/pagination.ts`, `components/pagedList.js` |
| Tareas largas al pintar listas              | Render por lotes de 50 filas que **ceden el hilo con una task** (`scheduler.yield()` o `setTimeout`), escrituras al DOM agrupadas en `requestAnimationFrame` y sin lecturas de layout intercaladas | `utils/scheduling.js`                                    |
| Layout de paneles fuera de pantalla         | `content-visibility: auto` + `contain-intrinsic-size` en paneles y alertas                                                                                                                         | `styles/components.css`                                  |
| Suma de 4.000 conceptos en el hilo de la UI | Agregación en un **Web Worker** cuando la lista tiene ≥ 500 elementos (mensajes tipados, cancelable)                                                                                               | `workers/concepts.worker.js`, `workers/workerClient.js`  |
| CLS 0,165                                   | Sidebar `position: sticky; height: 100vh`; `min-height` en el subtítulo                                                                                                                            | `styles/layout.css`                                      |
| 166,7 KB de fuentes de terceros             | Fuentes autoalojadas: Inter variable latín (48,3 KB) + Source Serif 4 600 latín (21,5 KB), `font-display: swap`, `preload` con el nombre hasheado                                                  | `styles/fonts.css`, `vite.config.js`                     |
| JSON sin comprimir                          | `compression` en Express; conceptos sin `id`/`documentId` (UUID aleatorios que no se usan)                                                                                                         | backend `app.ts`, `clients.service.ts`                   |
| Todo el JS en un solo archivo               | Code-splitting por vista (`import()` dinámico); `web-vitals` se carga después de `load`, en tiempo ocioso                                                                                          | `main.js`, `router.js`                                   |

**¿Por qué ceder con una task y no con una microtask?** `await Promise.resolve()` o `queueMicrotask()` encolan una microtask, y el navegador vacía la cola de microtasks **completa** antes de volver al event loop. Partir el trabajo en microtasks no crea ningún punto donde el navegador pueda pintar o atender un clic: para él sigue siendo una sola tarea larga. Una _task_ (`scheduler.yield()`, `setTimeout`) sí le devuelve el control al event loop entre lote y lote.

## 4. Resultado (DESPUÉS)

Mismo método, mismo dataset, 2026-09-28 a las 03:27 UTC. Datos: `perf/results/antes.json` y `perf/results/despues.json`.

### login

| Métrica              |    Antes |             Después |
| -------------------- | -------: | ------------------: |
| FCP                  |   416 ms |              280 ms |
| LCP                  |   416 ms |              280 ms |
| CLS                  |    0,002 |                   0 |
| TBT                  |     4 ms |                0 ms |
| Tarea más larga      |    54 ms | — (ninguna > 50 ms) |
| JS transferido       |   9,9 KB |               10 KB |
| Fuentes transferidas | 166,7 KB |             68,2 KB |
| Bytes de terceros    |   168 KB |                0 KB |
| Peticiones           |        7 |                  11 |

### dashboard (1.004 clientes)

| Métrica                            |    Antes | Después |
| ---------------------------------- | -------: | ------: |
| Tiempo hasta ver la tabla completa |   830 ms |  397 ms |
| LCP                                |   428 ms |  312 ms |
| CLS                                |    0,002 |       0 |
| INP (clic en "Entrar")             |    16 ms |   32 ms |
| TBT                                |   249 ms |    0 ms |
| Tarea más larga                    |   258 ms |       — |
| JSON de la API                     | 291,4 KB |  2,2 KB |
| JS transferido                     |   9,9 KB | 13,5 KB |

### detail (1.500 documentos, 4.000 conceptos, 300 alertas)

| Métrica                     |        Antes |   Después |
| --------------------------- | -----------: | --------: |
| Tiempo hasta ver las tablas |     4.286 ms |    441 ms |
| LCP                         |       404 ms |    312 ms |
| **CLS**                     |    **0,165** |     **0** |
| **INP** (clics en pestañas) | **1.168 ms** | **32 ms** |
| **TBT**                     | **3.623 ms** |  **0 ms** |
| Tareas largas               |           10 |         0 |
| Tarea más larga             |     1.126 ms |         — |
| JSON de la API              |   2.284,5 KB |   35,2 KB |
| JS transferido              |       9,9 KB |   20,8 KB |

INP por corrida: antes 1.168, 1.152, 1.216, 1.232, 1.160 ms; después 32, 40, 32, 32, 32 ms.

**Perfil del hilo principal después** (`perf/results/profile-despues.json`): layout 69 ms en la carga (antes 516) y 27 ms en los clics (antes 1.321); **ninguna tarea larga**.

### Lecturas honestas

- **La mayor parte de la mejora del detalle viene de hacer MENOS trabajo** (paginación: 50 filas en vez de 1.500), no de hacer el mismo trabajo más rápido. Es la optimización correcta para este caso, pero no se debe atribuir a una sola técnica. El efecto aislado del render por lotes está en la sección 5.
- **INP del dashboard: 16 → 32 ms** (sigue "bueno", < 200 ms). La interacción medida es el clic en "Entrar", que ahora también descarga el chunk de la vista (code-splitting). Por corrida: antes 16 en las 5; después 32, 16, 32, 40, 16.
- **Más JS en dashboard y detalle** (9,9 → 13,5 y 20,8 KB): son las funciones de las Fases 1 y 2 (tiempo real, paginación, workers, resumen) más `web-vitals` (4,34 KB gzip). En el login, el JS se mantiene igual (9,9 → 10 KB) gracias al code-splitting, aunque la app tiene mucho más código.
- **Más peticiones:** los chunks del code-splitting. En HTTP/2 o HTTP/3 (producción detrás de CloudFront), el costo por petición es bajo; no se midió en producción.

## 5. Experimento A/B: render por lotes con y sin ceder el hilo

Para aislar la técnica del event loop, se midió la misma interacción con dos builds:

- **A**: el código normal (lotes de 50 filas, cediendo con una task).
- **B**: un build temporal con `batchSize = 1e9` (un solo lote, sin ceder). No se comiteó.

Escenario `conceptsMore` (`perf/measure.mjs --scenario conceptsMore`): 3 clics en "Mostrar más conceptos" (200 filas cada uno), 5 corridas, mismas condiciones.

| Variante             | INP (mediana) | INP por corrida    | Tareas largas | Tarea más larga por corrida |   TBT |
| -------------------- | ------------: | ------------------ | ------------: | --------------------------- | ----: |
| **A (cede el hilo)** |     **56 ms** | 48, 48, 56, 56, 56 |             0 | —                           |  0 ms |
| B (sin ceder)        |         88 ms | 96, 88, 88, 96, 80 |             1 | 63, 62, 63, 65, 60 ms       | 13 ms |

La diferencia es modesta, porque 200 filas no son un bloque enorme, pero es **consistente en las 5 corridas**: sin ceder, cada lote de 200 filas es una tarea larga de ~63 ms; cediendo, ninguna llega a 50 ms.

## 6. Lighthouse (laboratorio)

`@lhci/cli` 0.15.1 (Lighthouse 12.6.1), perfil **móvil** por defecto (simulado: 150 ms RTT, 1,6 Mbps, CPU 4×), 3 corridas sobre `dist/` (página de login, la única accesible sin sesión). El "antes" se obtuvo compilando el commit `b286b6f` en un worktree temporal con la misma configuración.

|                        | Antes (3 corridas)       | Después (3 corridas)     |
| ---------------------- | ------------------------ | ------------------------ |
| Puntaje de rendimiento | 1,00 · 0,87 · 0,87       | 1,00 · 1,00 · 1,00       |
| LCP                    | 1.467 · 3.152 · 3.144 ms | 1.658 · 1.658 · 1.656 ms |
| FCP                    | 1.467 · 3.152 · 3.144 ms | 1.065 · 1.068 · 1.066 ms |
| TBT                    | 0 · 0 · 0 ms             | 0 · 0 · 0 ms             |
| CLS                    | 0,017 · 0,017 · 0,017    | 0 · 0 · 0                |
| Accesibilidad          | 1,00 · 1,00 · 1,00       | 1,00 · 1,00 · 1,00       |
| Terceros               | Google Fonts             | ninguno                  |

El "antes" varía mucho entre corridas (1,5 s vs. 3,1 s de LCP) porque dependía de la red real hacia Google Fonts. El "después", sin terceros, es estable.

En el "antes", FCP y LCP coinciden porque la hoja de estilos de Google Fonts, dentro del `<head>`, **bloquea el primer render** hasta descargarse de otro dominio. En el "después", el primer render no espera a terceros (FCP 1,07 s). El LCP llega más tarde (1,66 s): **no se investigó** cuál es el elemento candidato final ni por qué se reporta después del FCP.

**En CI** (`.github/workflows/ci.yml`), Lighthouse corre con presupuestos **LCP < 2,5 s, CLS < 0,1 y TBT < 200 ms** (TBT es el sustituto de INP en laboratorio: sin usuario real no hay interacciones), más rendimiento y accesibilidad ≥ 0,9. Empieza en **modo advertencia** (`continue-on-error`): no bloquea el merge.

## 7. Presupuesto de tamaño del bundle

`scripts/check-bundle.mjs` se ejecuta con `npm run build` (y por lo tanto en CI) y **falla** si se excede un límite. Tamaños gzip nivel 9, medidos al fijar el presupuesto:

| Recurso                               |   Medido |     Límite |
| ------------------------------------- | -------: | ---------: |
| JS de entrada                         |  2,69 KB |       4 KB |
| Chunk más grande (detalle de cliente) |  7,24 KB |      10 KB |
| JS total (todos los chunks)           | 22,88 KB |      30 KB |
| CSS total                             |  2,99 KB |       4 KB |
| Fuentes (woff2)                       | 68,15 KB |      75 KB |
| Fuentes de Google en `index.html`     |  ninguna | prohibidas |

## 8. Métricas de usuarios reales (RUM)

La app reporta sus propias Web Vitals (`src/metrics/webVitals.js`), y un administrador las ve en **Rendimiento** (`#/performance`) como p75 por métrica y ruta.

- **INP vs. FID:** INP (Interaction to Next Paint) reemplazó a FID como Core Web Vital en marzo de 2024. FID medía solo la _espera_ antes de procesar la _primera_ interacción. INP mide la latencia completa (espera + procesamiento + pintado del siguiente frame) de _todas_ las interacciones y reporta una de las peores. `web-vitals` 6.2.2, la versión instalada, ya no exporta `onFID`: se verificó buscándolo en el bundle, con 0 coincidencias. FID se captura aparte con `PerformanceObserver({ type: "first-input" })`, solo como referencia histórica.
- **Tareas largas:** `long-animation-frame` (LoAF, atribuye el script responsable) donde existe; si no, `longtask`.
- **Privacidad:** solo la ruta normalizada (`/clients/:id`) y una categoría de dispositivo. Sin usuario, IP, user-agent ni URL real. Se envía con `navigator.sendBeacon` como `text/plain`, que no dispara preflight CORS.
- **Limitación:** en una SPA, LCP, CLS y TTFB se miden una vez por carga de página (la ruta inicial). Las navegaciones internas por hash no generan un LCP nuevo. INP sí cubre todas las interacciones de la sesión.
- **No medido:** todavía no hay datos de usuarios reales en producción (la app no está desplegada). La vista funciona con los datos que genere el uso local.

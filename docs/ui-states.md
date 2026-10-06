# Estados explícitos de las vistas (Fase 5, bloque B2)

Cada vista que pide datos muestra uno de estos estados, y nunca una pantalla en
blanco ni un "Cargando..." de texto suelto:

| Estado                | Cómo se ve                                                                                                                                                                                                                | Componente                                                   |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| **Cargando**          | Skeleton con la forma del contenido final (filas, ítems, bloque de texto). **Estático**: sin shimmer ni pulso. `aria-busy` en el contenedor y "Cargando …" oculto para lectores de pantalla; el skeleton es `aria-hidden` | `skeletonRowsHtml`, `skeletonItemsHtml`, `skeletonBlockHtml` |
| **Error**             | Qué falló, el mensaje de la API y el botón **Reintentar**, que vuelve a pedir **solo esos datos**, sin recargar la página                                                                                                 | `errorStateHtml` + `bindRetry`                               |
| **Vacío**             | Qué significa y qué puede hacer el usuario (según su rol)                                                                                                                                                                 | `emptyStateHtml`                                             |
| **Enviando**          | Botón deshabilitado con el texto de la acción en curso ("Guardando…") y `aria-busy`                                                                                                                                       | `setPending`                                                 |
| **Éxito**             | Toast de confirmación tras cada acción que cambia algo                                                                                                                                                                    | `showToast(…, "success")`                                    |
| **Procesando con IA** | Punto con pulso: la única animación continua del sistema (decisión D4)                                                                                                                                                    | clase `.ai-processing`                                       |

Todo vive en `src/components/states.js`. La lista paginada (`pagedList.js`)
lo aplica sola a clientes, documentos y alertas.

## Estados por vista

| Vista / sección                | Cargando                                                    | Error + Reintentar                                   | Vacío                                                                                                                   | Confirmación de éxito                                                                                   |
| ------------------------------ | ----------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Login / registro               | botón "Entrando…" / "Creando cuenta…"                       | toast de error                                       | —                                                                                                                       | toast "Bienvenido…"                                                                                     |
| Clientes                       | skeleton de filas                                           | sí (solo la lista)                                   | según el rol: contador ("Crea el primero…"), asistente ("Cuando el contador al que apoyas…"), portal ("Tu expediente…") | botón "Guardando…" + toast `Cliente "X" creado.`                                                        |
| "Cargar más" (cualquier lista) | `aria-busy` en el botón                                     | mensaje **visible** y el botón pasa a "Reintentar"   | —                                                                                                                       | anuncio "Se cargaron N … más"                                                                           |
| Detalle: encabezado            | skeleton del título                                         | sí (en el encabezado)                                | —                                                                                                                       | —                                                                                                       |
| Detalle: conceptos             | skeleton de filas                                           | sí                                                   | "Aparecen solos cuando la IA termina…"                                                                                  | —                                                                                                       |
| Detalle: documentos            | skeleton de filas                                           | sí                                                   | según permiso: "Sube un certificado…" o "Tu contador los subirá…"                                                       | toast al subir y al reintentar el análisis; "Procesando" con el indicador de IA                         |
| Detalle: alertas               | skeleton de ítems                                           | sí                                                   | explica cuándo se crean                                                                                                 | toast "Alerta resuelta." / "Alerta marcada como vista." (antes solo se anunciaba al lector de pantalla) |
| Detalle: resumen               | skeleton de bloque + botón "Generando…" con indicador de IA | sí (reenvía el mismo año)                            | estado inicial que explica qué se obtiene                                                                               | el resumen aparece en una región `aria-live`                                                            |
| Detalle: chat                  | burbuja "Pensando…" con indicador de IA                     | "Reintentar" en la misma burbuja (la misma pregunta) | ejemplo de pregunta                                                                                                     | la respuesta en la burbuja                                                                              |
| Rendimiento                    | skeleton de filas (también al cambiar un filtro)            | sí                                                   | "Prueba con un período más largo…"                                                                                      | —                                                                                                       |
| Cerrar sesión                  | —                                                           | —                                                    | —                                                                                                                       | toast "Cerraste sesión."                                                                                |

## Avisos flotantes y clics

Regla: **ningún aviso flotante bloquea los clics de lo que tapa**.

| Aviso                                     | ¿Tiene algo clicable?     | `pointer-events`                                |
| ----------------------------------------- | ------------------------- | ----------------------------------------------- |
| Toasts (`#toast-root`)                    | no                        | `none` en el contenedor, que los toasts heredan |
| Banner "Sin conexión" (sticky arriba)     | no                        | `none`                                          |
| Aviso de versión nueva (`.update-banner`) | sí (Recargar / Más tarde) | normal, solo en su propia caja                  |

`e2e/states.spec.js` lo verifica en Chrome: `elementFromPoint` en el centro
del toast y del banner devuelve la página, y un clic real en ese punto llega al
elemento de abajo. Si un aviso futuro necesita un botón, debe ser otro
componente (como `updateBanner.js`), no un toast.

## Conectividad

- **Toast al perder la conexión** (advertencia: "Se perdió la conexión a internet. Puedes
  seguir consultando los datos guardados.") y **al recuperarla** ("Conexión restablecida.").
  Solo en la transición: no al cargar la página ni si el estado se repite.
- El banner "Sin conexión · Solo lectura" se mantiene mientras dure la desconexión.
- **Corrección de accesibilidad (existía antes de B2)**: sin conexión, los botones que
  necesitan red se atenuaban al 55 % de opacidad y su texto bajaba de 4.5:1. Nunca se había
  medido porque axe no corría en el estado sin conexión. Ahora esos controles reciben
  `aria-disabled="true"` (también los que se pintan después, con un `MutationObserver`): el
  lector de pantalla los anuncia como no disponibles y, al ser controles inactivos, quedan
  exentos del contraste (WCAG 1.4.3). La atenuación se aplica solo junto con `aria-disabled`.

## Otros arreglos encontrados al revisar los estados

- **Vacío del panel de clientes**: al asistente y al usuario del portal se les decía
  "Crea el primero con Nuevo cliente", un botón que no tienen.
- **Rendimiento**: al cambiar dos filtros seguidos, una respuesta vieja podía pisar la nueva
  (ahora cada carga tiene un número y solo pinta la última).
- **Chat**: el campo se leía como `form.question`; ahora `form.elements.question`, que es lo
  estándar y funciona igual en el navegador y en jsdom.

## Presupuesto

| Medición (build)     | Antes de B2 | Después  | Presupuesto    |
| -------------------- | ----------- | -------- | -------------- |
| JS total (gzip)      | 28,19 KB    | 30,08 KB | 30 → **34 KB** |
| CSS total (gzip)     | 3,80 KB     | 4,19 KB  | 4 → **5 KB**   |
| JS de entrada (gzip) | 3,62 KB     | 3,61 KB  | 4 KB           |

El crecimiento es el código de los estados, compartido por tres vistas en un chunk propio.
Las reglas de CSS `.table__empty` quedaron sin uso y se eliminaron.

## Pruebas

| Qué                                                                                                                                                                                     | Dónde                  |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Skeleton sin estilos en línea (CSP) ni animación; error escapado con Reintentar; vacío; `setPending`                                                                                    | `tests/states.test.js` |
| Lista paginada: skeleton + `aria-busy`, sin parpadeo al recargar, Reintentar sin recargar la página, error visible en "Cargar más"                                                      | `tests/states.test.js` |
| Vacío según el rol; chat y resumen con Reintentar; toasts de conectividad; `aria-disabled` sin red                                                                                      | `tests/states.test.js` |
| Chrome real: skeleton → error → Reintentar → datos sin recargar y sin violaciones de CSP; vacío; avisos que no bloquean clics; toasts de conexión; axe en claro y oscuro en cada estado | `e2e/states.spec.js`   |
| Solo `.ai-processing` anima de forma continua                                                                                                                                           | `tests/motion.test.js` |

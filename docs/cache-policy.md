# Política de caché

Qué se guarda, dónde, cuánto tiempo y por qué. El criterio que manda es de **seguridad**: esta app maneja datos tributarios de terceros (los clientes del contador), muchas veces en equipos compartidos de una oficina.

## Resumen

| Qué                                                                             | Dónde                                      | Estrategia                                                                    | Vida                                                            | Por qué                                                                  |
| ------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------------ |
| Respuestas de la API (`/api/*`)                                                 | **en ningún lado** del navegador/proxy/CDN | `Cache-Control: no-store` (backend) + el Service Worker **no las intercepta** | —                                                               | Datos tributarios y personales, dependientes del usuario autenticado     |
| `index.html` (shell de la app)                                                  | Cache Storage (SW)                         | stale-while-revalidate + aviso "hay una versión nueva"                        | hasta el siguiente build                                        | Arranque instantáneo y offline, sin quedar atrapado en una versión vieja |
| `/assets/*` (JS, CSS, fuentes con hash en el nombre)                            | Cache Storage (SW) + caché HTTP            | cache-first, **inmutables**                                                   | hasta el siguiente build (SW) / 1 año (HTTP)                    | El nombre cambia si cambia el contenido: nunca hay que revalidarlos      |
| `offline.html`, `favicon.svg`                                                   | Cache Storage (SW)                         | precache                                                                      | hasta el siguiente build                                        | Página propia cuando no hay red ni shell guardado                        |
| Lista de clientes, detalle básico de un cliente, listas de documentos ya vistas | **IndexedDB**, una base por usuario        | copia de solo lectura para usar sin conexión                                  | **24 h**; se **borra al cerrar sesión o al cambiar de usuario** | Poder consultar "qué clientes y documentos tengo" sin red                |
| Conceptos con montos, resúmenes, alertas, chat                                  | **en ningún lado**                         | siempre de la red                                                             | —                                                               | Son los datos más sensibles; offline se muestra "sin conexión"           |
| Token de sesión                                                                 | ver `docs/adr` (esquema de sesión)         | —                                                                             | —                                                               | —                                                                        |

## Backend: `Cache-Control`

`renta-ia-backend/src/app.ts` pone `Cache-Control: no-store` en **todas** las respuestas: API, errores y `/health` (test: `tests/integration/cachePolicy.test.ts`). `no-store` (y no `no-cache` o `private`) porque no debe quedar ninguna copia, ni siquiera para revalidar.

## Assets estáticos: inmutables

Vite genera los nombres con hash de contenido (`index-BaoOQ32D.js`). En producción (S3 + CloudFront, fase de despliegue) la configuración debe ser:

| Ruta                                                 | `Cache-Control`                                                            |
| ---------------------------------------------------- | -------------------------------------------------------------------------- |
| `/assets/*`                                          | `public, max-age=31536000, immutable`                                      |
| `/index.html`, `/service-worker.js`, `/offline.html` | `no-cache` (se revalidan siempre: son los que apuntan a los assets nuevos) |

Esto **todavía no está aplicado**: `vite preview` y el servidor de desarrollo no permiten configurarlo, y la infraestructura de despliegue queda para después.

## Service Worker (`src/sw/service-worker.js`)

- **Solo en el build de producción.** En desarrollo no se registra, y se desregistra si quedó uno. Durante el desarrollo de este proyecto, un SW registrado en el servidor de Vite siguió sirviendo un `index.html` viejo, con Google Fonts, horas después de haberlo cambiado.
- **Versionado por build.** `vite.config.js` emite `/service-worker.js` con un `BUILD_ID` (hash de los nombres del bundle) y la lista real de archivos a precachear. Cada despliegue cambia el archivo del SW, y el navegador detecta la versión nueva.
- **Actualización controlada por el usuario.** El SW nuevo se instala pero **espera** (no hace `skipWaiting` solo). La página muestra "Hay una versión nueva de Renta IA · Recargar". Así no se mezcla el JS viejo que ya está corriendo con assets nuevos, ni se recarga mientras el usuario escribe. Además, las pestañas abiertas todo el día buscan actualizaciones cada 30 minutos.
- **Shell stale-while-revalidate.** Se responde con el `index.html` guardado y en paralelo se pide el de la red; si cambió, se guarda y se envía `SHELL_UPDATED` a la página, que muestra el mismo aviso.
- **Limpieza.** Al activarse, borra las cachés de builds anteriores (`renta-ia-<build>`) y las de versiones viejas del SW (`renta-ia-cache-v1/v2`, que en la v1 llegó a guardar respuestas de la API).
- **Nunca** intercepta la API ni otros orígenes, ni peticiones que no sean GET.

Tests: `tests/serviceWorker.test.js`.

## Datos offline en IndexedDB (`src/offline/offlineStore.js`)

- **Qué:** solo las respuestas GET de `/api/clients`, `/api/clients/:id` y `/api/documents/client/:id`. **No** se guardan conceptos con montos, resúmenes, alertas ni el chat.
- **Aislamiento:** una base por usuario (`renta-ia-offline-<userId>`).
- **Borrado:** al cerrar sesión se borran todas; al iniciar sesión, las de cualquier otro usuario (`main.js`).
- **TTL:** 24 horas; una entrada vencida se borra al leerla.
- **Cuándo se usa:** solo si la red falla después de los reintentos. La pantalla muestra "Sin conexión · Mostrando datos guardados hace X".
- **Riesgo residual:** mientras la sesión está abierta, alguien con acceso físico al equipo puede leer esos listados desde las herramientas del navegador. Es el mismo acceso que ya tendría viendo la pantalla; se limita el contenido a datos no monetarios y a 24 h.

## Sin conexión: solo lectura

- Todo control que escribe está marcado con `data-requires-network`: subir documentos, crear clientes, chat, resumen, reintentar y cambiar alertas. Sin conexión se bloquea antes de llegar a la vista y se explica por qué.
- `http.js` además rechaza cualquier POST/PATCH/DELETE si `navigator.onLine === false`.
- **Nada se encola** para enviarlo después. Una subida diferida podría duplicar documentos o aplicarse sobre datos que ya cambiaron.

## Red: reintentos y cancelación (`src/api/http.js`)

- **Reintentos solo para GET**, porque es idempotente: hasta 2, con backoff exponencial y jitter (`utils/backoff.js`: 250–500 ms y luego 500–1000 ms). Se reintenta ante errores de red y 502/503/504/429; un 429 respeta `Retry-After` (hasta 10 s). Un POST nunca se reintenta: si la respuesta se perdió, reintentar podría subir dos veces el mismo documento.
- **Cancelación al cambiar de vista:** cada navegación aborta la señal de la vista anterior (`router.js` → `getRouteSignal()`), y los GET en vuelo se cancelan (`AbortError`, sin toast de error). Las escrituras no se cancelan a medias.
- **Timeout** de 15 s (60 s para el chat y la subida), independiente de la cancelación.

Tests: `tests/offline.test.js`, `tests/http.test.js`.

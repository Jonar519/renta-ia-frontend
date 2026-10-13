# renta-ia-frontend

Interfaz web (SPA) del **Sistema de Gestión Documental Contable con IA**: login (las cuentas se
crean por invitación de un administrador, con verificación en dos pasos), clientes, subida y
seguimiento de documentos **en tiempo real**, el original junto a sus conceptos tributarios para
revisarlos, alertas, resumen ejecutivo y chat sobre cada cliente. Además: mi perfil y foto,
sesiones activas, mis datos (exportar y eliminar), administración de usuarios y rendimiento.

**JavaScript sin framework** con Vite solo para el build
([ADR 0001](../renta-ia-backend/docs/adr/0001-js-sin-framework-y-router-hash.md)).

- **Guía de prueba completa (Fase 5):** [`../renta-ia-backend/docs/demo-fase5.md`](../renta-ia-backend/docs/demo-fase5.md)
- Diseño: [`docs/design-tokens-audit.md`](docs/design-tokens-audit.md), [`docs/dark-mode.md`](docs/dark-mode.md) (tema del sistema), [`docs/ui-states.md`](docs/ui-states.md), [`docs/shell.md`](docs/shell.md)
- Rendimiento medido antes/después: [`docs/performance-report.md`](docs/performance-report.md)
- Política de caché y offline: [`docs/cache-policy.md`](docs/cache-policy.md)
- Seguridad (sesión, CSP, dependencias): [`docs/security.md`](docs/security.md)
- E2E: [`e2e/README.md`](e2e/README.md)

## Estructura

```
renta-ia-frontend/
├── index.html · vite.config.js      # build: preload de fuentes, Service Worker versionado, CSP
├── public/offline.html
├── src/
│   ├── main.js · router.js          # router por hash, vistas con code-splitting
│   ├── state/store.js               # sesión: access token SOLO en memoria
│   ├── auth/                        # session.js (refresh single-flight, logout), permissions.js (UI por rol)
│   ├── api/                         # http.js (timeouts, reintentos GET, renovación ante 401, offline) + un módulo por recurso
│   ├── views/                       # login, invitación, recuperación, perfil, seguridad (MFA y sesiones), clientes,
│   │                                # usuarios (admin), rendimiento y clientDetail/ (pestañas, documentos, visor, revisión)
│   ├── components/                  # sidebar y menú de la cuenta, toast, tabs, estados, densidad, recorte de la foto…
│   ├── realtime/                    # WebSocket con respaldo de polling
│   ├── offline/                     # IndexedDB por usuario (solo lectura, 24 h) y estado de conexión
│   ├── workers/                     # Web Workers: SHA-256 del archivo, agregación de conceptos
│   ├── sw/                          # Service Worker y su registro
│   ├── metrics/webVitals.js         # RUM anónimo
│   └── styles/
├── tests/                           # Vitest + jsdom
├── e2e/                             # Playwright + axe
├── perf/                            # mediciones de rendimiento (Playwright)
└── scripts/check-bundle.mjs         # presupuesto de tamaño en cada build
```

## Puesta en marcha (Windows · cmd.exe)

Requisitos: Node.js 20+ y el backend corriendo (API + worker; ver el README raíz).
El CI usa exactamente **Node 24.13.1** (la versión de desarrollo; `node-version` en
`.github/workflows/ci.yml`). Los tests también pasan en Node 20.

```bat
npm install
copy .env.example .env
npm run dev
```

Abre **http://localhost:5173**. En desarrollo no hay Service Worker ni CSP
(se aplican en el build).

| Variable       | Descripción                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------- |
| `VITE_API_URL` | URL de la API (por defecto `http://localhost:4000`). También define `connect-src` de la CSP del build |

Build de producción y vista previa (con Service Worker y CSP):

```bat
npm run build
npm run preview
```

`npm run build` falla si se supera el presupuesto de tamaño (`scripts/check-bundle.mjs`, gzip). Los
topes solo se cambian con una decisión escrita, que queda anotada junto a cada uno:

| Presupuesto                                                                                      | Tope                      |
| ------------------------------------------------------------------------------------------------ | ------------------------- |
| JS de entrada                                                                                    | 4 KB                      |
| Cada chunk                                                                                       | 6 KB                      |
| CSS total                                                                                        | 7 KB                      |
| Fuentes                                                                                          | 95 KB                     |
| Primera carga: invitado (`#/login`) / con sesión (`#/`)                                          | 19 / 23 KB                |
| Peor caso por rol (todas sus pantallas): invitado / contador / asistente / contribuyente / admin | 24 / 57 / 57 / 55 / 63 KB |
| pdf.js (excepción D3, fuera de los topes por rol; solo al abrir un PDF)                          | 520 KB                    |

El chequeo también falla si pdf.js entra en el grafo estático de alguna pantalla, se empaqueta
como módulo, lo carga otro archivo que no sea el visor, el Service Worker lo precachea o su versión
no es exacta en `package.json`.

## Sesión

El access token (15 min) vive **solo en memoria**; al recargar, la app lo recupera
con la cookie `httpOnly` de refresh (que JavaScript no puede leer). En
`localStorage` solo queda una pista sin secretos (`id`, `name`, `role`).
Frontend y API deben ser del **mismo sitio** (p. ej. `app.x` y `api.x`): ver
[ADR 0007](../renta-ia-backend/docs/adr/0007-esquema-de-sesion.md).

La interfaz se adapta al rol (`src/auth/permissions.js`; la garantía es la API):

- el asistente no ve "Nuevo cliente";
- el contribuyente (`client`) ve su expediente en solo lectura, sin subida, resumen ni chat;
- el **visor del original y la vista dividida** son solo para contador y asistente: el
  contribuyente y el admin ven "Descargar".

Una ruta sin permiso no descarga su código: rebota a Clientes con un aviso (`docs/shell.md`).

## Técnicas de la plataforma que usa

- **Router por hash** con cancelación de peticiones y limpieza de suscripciones al cambiar de vista.
- **Web Workers**: validación y SHA-256 del archivo antes de subirlo; agregación de miles de conceptos.
- **Render por lotes** cediendo el hilo principal (`src/utils/scheduling.js`) y listas paginadas por cursor.
- **WebSocket** para el estado de los documentos, con polling de respaldo con backoff.
- **Service Worker**: shell con stale-while-revalidate y aviso de versión nueva, assets inmutables, página offline; nunca intercepta `/api/`.
- **IndexedDB**: copia de solo lectura por usuario con caducidad; sin red, las escrituras se bloquean.
- **Web Vitals** (RUM) y vista "Rendimiento" para el admin.
- **Tema del sistema** (`prefers-color-scheme`, sin interruptor) con tokens de diseño; el violeta
  es solo para lo que produce la IA.
- **pdf.js** del mismo origen y solo al abrir un PDF; las imágenes se muestran con `<img>`. La CSP
  sigue estricta (`object-src` y `frame-src` en `'none'`).

## Accesibilidad

Pestañas WAI-ARIA con teclado, regiones `aria-live`, foco al `<h1>` al cambiar de
vista, enlace "Saltar al contenido", tablas con `<caption>`/`scope`, contraste AA
y `prefers-reduced-motion`. Tablas en tarjetas en móvil (375 y 320 px, sin desplazamiento
horizontal). El E2E corre **axe** (WCAG 2.1 A/AA) en **tema claro y oscuro** en cada pantalla que
prueba, y falla ante violaciones _serious/critical_.
La prueba con lector de pantalla real es manual (ver el README raíz).

## Tests y calidad

```bat
npm test
npm run lint
npm run build
npm run test:e2e
npm run perf:measure
```

- `npm test`: Vitest + jsdom (sesión, http, offline, Service Worker, tiempo real, pestañas, Web Vitals…).
- `npm run test:e2e`: necesita el stack con IA simulada; ver [`e2e/README.md`](e2e/README.md).
- `npm run test:e2e`: además vigila la CSP en cada página (cero violaciones).
- CI: lint, tests, build con presupuesto, Lighthouse (advertencia), `security`
  (`npm audit --omit=dev` + gitleaks) y `e2e` (no bloqueante por ahora).
- `node scripts/demo-files.mjs <carpeta>`: un PDF y una imagen de prueba (datos sintéticos) para la guía.

## Pendiente

Despliegue (S3 + CloudFront) fuera del Proyecto 1. El servidor que sirva el
frontend deberá enviar `Content-Security-Policy: frame-ancestors 'none'`
(no funciona como `<meta>`).

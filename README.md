# renta-ia-frontend

Interfaz web (SPA) del **Sistema de Gestión Documental Contable con IA**: registro
y login, clientes, subida y seguimiento de documentos **en tiempo real**, conceptos
tributarios extraídos por IA, alertas, resumen ejecutivo y chat sobre cada cliente.

**JavaScript sin framework** con Vite solo para el build
([ADR 0001](../renta-ia-backend/docs/adr/0001-js-sin-framework-y-router-hash.md)).

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
│   ├── views/                       # login, dashboard, detalle de cliente (pestañas), rendimiento
│   ├── components/                  # sidebar, toast, tabs, pagedList, banners de conexión/actualización
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

`npm run build` falla si se supera el presupuesto de tamaño (JS de entrada ≤ 4 KB gzip,
chunk más grande ≤ 10 KB, JS total ≤ 30 KB, CSS ≤ 4 KB, fuentes ≤ 75 KB).

## Sesión

El access token (15 min) vive **solo en memoria**; al recargar, la app lo recupera
con la cookie `httpOnly` de refresh (que JavaScript no puede leer). En
`localStorage` solo queda una pista sin secretos (`id`, `name`, `role`).
Frontend y API deben ser del **mismo sitio** (p. ej. `app.x` y `api.x`): ver
[ADR 0007](../renta-ia-backend/docs/adr/0007-esquema-de-sesion.md).

La interfaz se adapta al rol: el asistente no ve "Nuevo cliente"; el usuario de
portal (`client`) ve su expediente en solo lectura, sin subida, resumen ni chat.

## Técnicas de la plataforma que usa

- **Router por hash** con cancelación de peticiones y limpieza de suscripciones al cambiar de vista.
- **Web Workers**: validación y SHA-256 del archivo antes de subirlo; agregación de miles de conceptos.
- **Render por lotes** cediendo el hilo principal (`src/utils/scheduling.js`) y listas paginadas por cursor.
- **WebSocket** para el estado de los documentos, con polling de respaldo con backoff.
- **Service Worker**: shell con stale-while-revalidate y aviso de versión nueva, assets inmutables, página offline; nunca intercepta `/api/`.
- **IndexedDB**: copia de solo lectura por usuario con caducidad; sin red, las escrituras se bloquean.
- **Web Vitals** (RUM) y vista "Rendimiento" para el admin.

## Accesibilidad

Pestañas WAI-ARIA con teclado, regiones `aria-live`, foco al `<h1>` al cambiar de
vista, enlace "Saltar al contenido", tablas con `<caption>`/`scope`, contraste AA
y `prefers-reduced-motion`. El E2E corre **axe** (WCAG 2.1 A/AA) en login,
dashboard y detalle: 0 violaciones _serious/critical_ en las corridas del 2026-09-28.
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
- CI: lint, tests, build con presupuesto, Lighthouse (advertencia), `security`
  (`npm audit --omit=dev` + gitleaks) y `e2e` (no bloqueante por ahora).

## Pendiente

Despliegue (S3 + CloudFront) fuera del Proyecto 1. El servidor que sirva el
frontend deberá enviar `Content-Security-Policy: frame-ancestors 'none'`
(no funciona como `<meta>`).

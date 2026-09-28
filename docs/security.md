# Seguridad del frontend

El modelo de amenazas completo (STRIDE, fronteras, riesgos residuales) está en
`renta-ia-backend/docs/threat-model.md`. Aquí se documenta lo que vive en este repo.

## Sesión

Ver `renta-ia-backend/docs/adr/0007-esquema-de-sesion.md`.

| Pieza                                                                        | Dónde                                                                          | Archivo                                  |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---------------------------------------- |
| Access token (JWT, 15 min)                                                   | solo en memoria                                                                | `src/state/store.js`                     |
| Refresh token (7 días, rota en cada uso)                                     | cookie `httpOnly`, `SameSite=Strict`, `Path=/api/auth`, `Secure` en producción | la pone la API; JS no puede leerla       |
| Pista `{ id, name, role }` (sin secretos)                                    | `localStorage["renta_ia_session"]`                                             | `src/state/store.js`                     |
| Renovación single-flight, proactiva y ante 401; 409 = carrera entre pestañas | —                                                                              | `src/auth/session.js`, `src/api/http.js` |
| Logout en el servidor + aviso a las demás pestañas (`BroadcastChannel`)      | —                                                                              | `src/auth/session.js`                    |

Al cargar la app se borran las claves del esquema anterior (`renta_ia_token`,
`renta_ia_user`), que guardaban un JWT de 1 día en `localStorage`.

**Restricción de despliegue:** la cookie es `SameSite=Strict`, así que el frontend
y la API deben ser del **mismo sitio** (mismo dominio registrable), por ejemplo
`app.ejemplo.com` y `api.ejemplo.com`. Con dominios distintos (`app.com` /
`api.net`) el navegador no enviaría la cookie y la sesión no podría renovarse.
En desarrollo, `localhost:5173` y `localhost:4000` son el mismo sitio (el puerto no cuenta).

## Content-Security-Policy

`vite.config.js` (`buildCsp`) agrega en el build un `<meta http-equiv="Content-Security-Policy">`:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self' <VITE_API_URL> <ws(s) de VITE_API_URL>;
worker-src 'self'; manifest-src 'self'; object-src 'none'; frame-src 'none';
base-uri 'self'; form-action 'self'
```

- Sin `'unsafe-inline'` ni `'unsafe-eval'`: un XSS no puede ejecutar scripts en
  línea ni exfiltrar datos a otros dominios (`connect-src` solo permite la API).
- Verificado en el navegador (build de `vite preview`): login, registro,
  recarga con recuperación de sesión, detalle de cliente, subida (Web Worker
  SHA-256), WebSocket y logout, **sin ninguna** violación
  (`securitypolicyviolation`).
- En desarrollo no se aplica (el HMR de Vite inyecta código en línea).
- **Pendiente para el despliegue:** `frame-ancestors` no funciona en `<meta>`.
  El servidor que sirva el frontend debe enviar
  `Content-Security-Policy: frame-ancestors 'none'` (anti clickjacking).
- Toda cadena que viene de la API se escapa con `src/utils/escapeHtml.js` antes
  de entrar a `innerHTML`.

## Dependencias (`npm audit`)

- `npm audit --omit=dev` (lo que llega al navegador): **0 vulnerabilidades**.
  El CI lo ejecuta en cada push (job `security`) junto con gitleaks.
- Quedan 4 avisos en dependencias de **desarrollo** (medido el 2026-09-28). No se
  corrigen con `npm audit fix --force` porque exigen versiones mayores:

| Paquete                              | Severidad | Aviso                                                         | Por qué no aplica en producción / mitigación                                                                                                                                                                         |
| ------------------------------------ | --------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vite` ≤ 6.4.2                       | alta      | GHSA-4w7w-66w2-5vf9, GHSA-v6wh-96g9-6wx3, GHSA-fx2h-pf6j-xcff | Afectan al **servidor de desarrollo**; el build de producción son archivos estáticos. El dev server escucha solo en `localhost` (no se configuró `server.host`). Arreglo: migrar a Vite 8 (cambio mayor, pendiente). |
| `esbuild` ≤ 0.24.2 (vía vite)        | moderada  | GHSA-67mh-4wv8-2f99                                           | Igual: solo el dev server.                                                                                                                                                                                           |
| `vitest` / `@vitest/mocker` ≤ 4.1.10 | moderada  | GHSA-82fw-gwwq-j7x9                                           | Solo corre en tests locales/CI con código propio. Arreglo: Vitest 5 (cambio mayor, pendiente).                                                                                                                       |

## Roles en la interfaz

`src/auth/permissions.js` oculta lo que el rol no puede hacer (el asistente no
crea clientes; el portal del contribuyente no sube, no edita, no ve resumen ni
chat). Es **solo presentación**: la autorización real está en la API y está cubierta por
`renta-ia-backend/tests/integration/roles.test.ts`.

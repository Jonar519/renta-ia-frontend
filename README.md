# renta-ia-frontend

Interfaz web (SPA) del **Sistema de Gestión Documental Contable con IA**: registro/login, gestión de clientes, subida y seguimiento de documentos, conceptos tributarios extraídos por IA, alertas y un chat con IA sobre la información de cada cliente.

Construida en **JavaScript sin framework**, con Vite como herramienta de build/desarrollo — tal como se definió en la arquitectura del proyecto (control fino del hilo principal y del pipeline de renderizado).

## Estructura del proyecto

```
renta-ia-frontend/
├── index.html
├── public/
│   ├── favicon.svg
│   └── service-worker.js       # Cache de assets + fallback offline para GETs de la API
├── src/
│   ├── main.js                  # Punto de entrada: router + vistas
│   ├── router.js                 # Router propio, basado en hash (#/...)
│   ├── state/store.js            # Estado de sesión (token/usuario), patrón pub/sub
│   ├── api/                      # Un módulo por recurso del backend
│   ├── views/                    # login, dashboard (clientes), detalle de cliente
│   ├── components/               # sidebar, toast
│   ├── workers/
│   │   └── fileValidation.worker.js   # Valida el archivo ANTES de subirlo, sin bloquear la UI
│   ├── sw/registerSW.js          # Registro del Service Worker
│   └── styles/                   # tokens.css, base.css, layout.css, components.css
```

## Requisitos

- Node.js 18 o superior
- El repositorio `renta-ia-backend` corriendo (API en `npm run dev`, worker en `npm run worker`)

## Puesta en marcha (Windows · cmd.exe)

Parado dentro de la carpeta `renta-ia-frontend`:

```bat
:: 1. Instalar dependencias
npm install

:: 2. Crear el archivo de variables de entorno
copy .env.example .env

:: 3. Levantar el servidor de desarrollo
npm run dev
```

Vite te dará una URL, normalmente `http://localhost:5173`. Ábrela en el navegador.

**Importante:** para que la app funcione de verdad, necesitas tener corriendo **al mismo tiempo** (cada uno en su propia ventana de cmd):
1. Docker: contenedores de Postgres y Redis
2. `renta-ia-backend` → `npm run dev` (la API, puerto 4000)
3. `renta-ia-backend` → `npm run worker` (el procesador de IA)
4. `renta-ia-frontend` → `npm run dev` (esta app, puerto 5173)

## Variables de entorno (`.env`)

| Variable | Descripción |
|---|---|
| `VITE_API_URL` | URL base del backend. En desarrollo: `http://localhost:4000` |

## Cómo está armada la app (sin framework)

- **Router propio** (`router.js`): un router basado en el hash de la URL (`#/`, `#/clients/:id`), con soporte de parámetros dinámicos. No usa ninguna librería.
- **Vistas** (`views/`): cada vista es una función que recibe el elemento raíz del DOM y construye su HTML con template strings, luego conecta los `addEventListener` necesarios. No hay virtual DOM: las actualizaciones parciales (como recargar la tabla de documentos) se hacen re-generando el `innerHTML` de un contenedor puntual, no de toda la página.
- **Estado** (`state/store.js`): un objeto simple con un patrón pub/sub, que persiste el token de sesión en `localStorage`.

  > **Nota de seguridad:** guardar el JWT en `localStorage` es una simplificación válida para este proyecto de curso, pero tiene un riesgo conocido (accesible por JavaScript malicioso en caso de un ataque XSS). En un entorno de producción más estricto, se preferiría una cookie `httpOnly`. Queda documentado como una mejora posible.

- **Web Worker** (`workers/fileValidation.worker.js`): antes de subir un archivo, se valida su tipo y tamaño en un hilo separado, para que la interfaz nunca se bloquee, ni siquiera con archivos grandes.
- **Service Worker** (`public/service-worker.js`): cachea los assets estáticos (cache-first) y guarda en caché las respuestas `GET` de la API (network-first con fallback a caché), permitiendo seguir viendo información ya consultada aunque la conexión falle momentáneamente. Nunca intercepta `POST`/`PATCH`/`DELETE`.

## Sistema de diseño

Paleta "Midnight Executive" (consistente con el resto del proyecto — arquitectura y presentación): navy (`#16233A` / `#1F3B57`) para la marca y la navegación, ámbar (`#B9770E`) reservado específicamente para todo lo relacionado con IA (burbujas del chat, por ejemplo), verde/rojo/azul para estados (procesado, alerta crítica, informativo). Tipografía serif (Source Serif 4) para encabezados —tono de "documento oficial"— y sans (Inter) para interfaz y datos, priorizando la legibilidad en tablas densas.

## Flujo de uso

1. Crear una cuenta o iniciar sesión.
2. Crear un cliente contribuyente (cédula/NIT, nombre).
3. Entrar al detalle del cliente y subir un documento (PDF con texto real, o imagen JPG/PNG).
4. El documento se sube y se encola; su estado pasa de `Subido` → `Procesando` → `Procesado`.
5. Cuando termina, la pestaña "Documentos" muestra los conceptos tributarios extraídos, y la pestaña "Alertas" muestra cualquier inconsistencia detectada.
6. En la pestaña "Asistente IA", se le pueden hacer preguntas en lenguaje natural sobre los documentos de ese cliente.

## Qué falta (próxima fase)

- **Fase 6:** build de producción (`npm run build`), despliegue del contenido estático en S3 + CloudFront, y `VITE_API_URL` apuntando al backend ya desplegado en AWS.

# Shell con sesión: guard de rutas por rol y menú de usuario (Fase 5, bloque B3)

## Guard de rutas por rol

Cada ruta declara quién puede entrar (`src/main.js`):

| Ruta            | Requiere sesión | Roles                                                |
| --------------- | --------------- | ---------------------------------------------------- |
| `#/login`       | no              | —                                                    |
| `#/` (Clientes) | sí              | todos                                                |
| `#/clients/:id` | sí              | todos (la API decide a qué clientes accede cada uno) |
| `#/profile`     | sí              | todos                                                |
| `#/performance` | sí              | **solo admin**                                       |

`src/auth/routeAccess.js` decide y `src/router.js` aplica la decisión **antes de descargar
el código de la vista**: una vista prohibida ni siquiera se pide al servidor.

| Situación                                                        | Resultado                                                                                                                              |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Rol sin permiso escribe la URL (enlace directo o cambio de hash) | Rebota a Clientes con el aviso `No tienes permiso para ver "Rendimiento". Tu rol (Asistente) no tiene acceso. Te llevamos a Clientes.` |
| Ruta que no existe, con sesión                                   | Clientes, con el aviso "La página que buscabas no existe."                                                                             |
| Sin sesión                                                       | Login ("Inicia sesión para continuar.")                                                                                                |
| Rol desconocido (pista manipulada o incompleta)                  | Rebota como cualquier rol sin permiso                                                                                                  |

- **El aviso** va dentro de la vista de destino, arriba y en el flujo normal (no flotante),
  con `role="alert"` y un botón "Entendido" que devuelve el foco al título.
- **El rebote reemplaza la entrada del historial** (`location.replace`): "Atrás" lleva a la
  página anterior y no a la ruta prohibida (con un _push_, rebotaría otra vez y el usuario
  quedaría atrapado). Durante la carga de la página el navegador ya convierte todo cambio
  de hash en _replace_; la diferencia se nota con la app cargada, y así se prueba.
- **Revalidación**: al abrir la app el rol sale de la pista de `localStorage` mientras se
  recupera la sesión. Cuando llega el usuario real, la ruta actual se vuelve a comprobar
  (`recheckRoute`); si el rol ya no alcanza, rebota.
- **Es experiencia de usuario, no seguridad**: alguien puede editar `localStorage` o el
  código en su navegador. La autorización real sigue en la API (`requireRole`,
  `clientScope`, 403/404).
- Antes de B3, `#/performance` comprobaba el rol **dentro** de la vista: descargaba su código
  y redirigía sin explicar nada.

## Menú de usuario

`src/components/userMenu.js`. Es el mismo en todas las pantallas con sesión (va en el
sidebar) y reemplaza el botón "Cerrar sesión". Muestra iniciales, nombre, rol y correo, con
las opciones **Mi perfil** (`#/profile`) y **Salir**.

Patrón "menu button" de WAI-ARIA:

| Tecla / acción                       | Efecto                                          |
| ------------------------------------ | ----------------------------------------------- |
| Clic, Enter, Espacio o ↓ en el botón | Abre y lleva el foco a la primera opción        |
| ↑ en el botón                        | Abre en la última opción                        |
| ↑ / ↓                                | Recorren las opciones (con vuelta)              |
| Inicio / Fin                         | Primera / última opción                         |
| Escape                               | Cierra y devuelve el foco al botón que lo abrió |
| Tab                                  | Cierra (el foco sigue su orden normal)          |
| Clic fuera                           | Cierra                                          |

- El botón lleva `aria-haspopup="menu"` y `aria-expanded`, y la lista `role="menu"`.
- El correo no está en la pista de `localStorage`: llega al recuperar la sesión, por eso la
  cabecera del menú se rellena **al abrirlo**.
- En escritorio abre hacia arriba, dentro del ancho del sidebar. En móvil (barra superior)
  va a la derecha, abre hacia abajo y oculta el nombre en el botón. Las reglas móviles están
  en `components.css`, después de las base: en `layout.css` quedaban pisadas por la cascada
  (el menú medía 2 px de alto).
- **Mi perfil** (`#/profile`), por ahora de solo lectura (nombre, correo y rol desde
  `GET /api/users/me`), con los estados de B2.

## Sin conexión

- **Sidebar**: el banner "Sin conexión" (sticky arriba) empujaba el sidebar sticky, que
  medía `100vh` y dejaba cortado su borde inferior (antes "Cerrar sesión", ahora el menú).
  El banner publica su altura real (`--offline-banner-h`, con `ResizeObserver`, porque en
  móvil ocupa varias líneas) y el sidebar empieza debajo y mide el resto.
- **Respuesta tardía**: una petición que salió antes de cortar la red y terminaba después
  volvía a marcar la app "en línea" (y avisaba "Conexión restablecida") aunque el navegador
  dijera que no había red. Ahora `navigator.onLine === false` manda: puede dar falsos
  "en línea", pero su "sin conexión" es definitivo. Apareció como una prueba E2E
  intermitente (1 de cada 3 corridas).

## Presupuesto del JS de entrada

El guard tiene que estar en la entrada (decide antes de descargar cualquier vista). Para
caber en 4 KB se difieren dos cosas que no hacen falta en la primera pintura: el aviso de
rebote y el aviso de versión nueva del Service Worker. Medido: **3,95 KB de 4 KB**. El
margen es chico: la ruta de administración de B6 puede obligar a revisarlo.

## Pruebas

| Qué                                                                                                                                                                                                                                                                                                 | Dónde                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| Decisión por rol, rol desconocido, ruta inexistente, sin sesión                                                                                                                                                                                                                                     | `tests/guard.test.js`    |
| Router: rebote sin ejecutar la vista, aviso y su cierre, admin entra, revalidación al cambiar el rol                                                                                                                                                                                                | `tests/guard.test.js`    |
| Menú: ARIA, foco, flechas con vuelta, Inicio/Fin, Escape, Tab, clic fuera, Salir, datos al abrir, escape de HTML                                                                                                                                                                                    | `tests/userMenu.test.js` |
| Respuesta tardía con `navigator.onLine === false`                                                                                                                                                                                                                                                   | `tests/states.test.js`   |
| Chrome: asistente con enlace directo y con cambio de hash (sin descargar la vista y sin violaciones de CSP), historial y "Atrás", contador rebota y admin entra, ruta inexistente, menú por teclado y ratón, Mi perfil, Salir, menú en móvil sin recortes, sidebar sin conexión; axe en ambos temas | `e2e/guard.spec.js`      |

El job E2E del CI ahora carga el seed (`renta-ia-database/scripts/seed.sh`): las pruebas
usan sus usuarios admin, contador y asistente (decisión D1: datos solo de desarrollo y pruebas).

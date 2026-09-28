# E2E del flujo crítico (Playwright + axe)

`critical-flow.spec.js` recorre, en un navegador real y sin atajos por la API:
registro → crear cliente → subir documento → ver el cambio de estado **en tiempo
real** (WebSocket, sin recargar) → alerta → resumen → chat. En tres pantallas
corre **axe** (WCAG 2.1 A/AA) y falla ante violaciones _serious_ o _critical_;
además falla si hay alguna violación de la CSP.

La IA es **simulada** (`AI_PROVIDER=mock`, solo para pruebas; la API se niega a
arrancar con él si `NODE_ENV=production`). Lo que depende de Anthropic/Voyage
reales se prueba a mano (ver la lista del README raíz).

## Correrlo en local (cmd.exe)

1. Base de pruebas con migraciones (desde `renta-ia-database`):

   ```bat
   docker exec renta_ia_postgres psql -U postgres -c "CREATE DATABASE renta_ia_e2e"
   set DB_NAME=renta_ia_e2e
   scripts\migrate.bat
   ```

   (El `CREATE DATABASE` solo la primera vez.)

2. API y worker con IA simulada (desde `renta-ia-backend`, dos ventanas):

   ```bat
   set AI_PROVIDER=mock
   set AI_MOCK_LATENCY_MS=1500
   set DATABASE_URL=postgresql://postgres:postgres@localhost:5433/renta_ia_e2e
   set REDIS_URL=redis://localhost:6379/1
   set CORS_ORIGIN=http://localhost:4173
   set PORT=4100
   npm run dev
   ```

   En la otra ventana, las mismas variables (sin `PORT`) y `npm run worker`.
   `AI_MOCK_LATENCY_MS=1500` hace visible el estado "Procesando".

3. Frontend compilado contra esa API y servido con su CSP (desde `renta-ia-frontend`):

   ```bat
   set VITE_API_URL=http://localhost:4100
   npm run build
   npm run preview
   ```

4. En otra ventana:

   ```bat
   npm run test:e2e
   ```

Usa el Chrome instalado (`channel: "chrome"`); en CI usa el Chromium de Playwright.
Resultados medidos el 2026-09-28: 3 corridas seguidas, 3 aprobadas (~10,6 s cada una).

## En CI

Job `e2e` de `.github/workflows/ci.yml`, **no bloqueante** al principio
(`continue-on-error: true`). Sube el reporte de Playwright y los logs de la API
y del worker como artefacto.

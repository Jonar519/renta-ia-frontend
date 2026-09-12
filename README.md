# renta-ia-frontend

Interfaz web (SPA) del **Sistema de Gestión Documental Contable con IA**: carga de documentos, panel de alertas, resumen ejecutivo y chat con el asistente de IA.

> Este repositorio se construye en la **Fase 4** del plan de trabajo (sistema de diseño, vistas, Web Workers, Service Worker). Por ahora contiene solo la configuración base.

## Depende de

- [`renta-ia-backend`](../renta-ia-backend): esta SPA consume la API REST y el canal WebSocket expuestos por ese repositorio.

## Stack

- JavaScript (sin framework) + Vite
- Web Workers (validación y pre-lectura de documentos)
- Service Worker (cache y modo offline)

## Próximos pasos

Ver el plan completo de construcción — Fase 4 (frontend).

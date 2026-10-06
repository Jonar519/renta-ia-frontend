/**
 * Nombre visible de cada rol (sin suponer género). Módulo aparte de
 * routeAccess.js: solo lo usan vistas y avisos que se cargan de forma
 * diferida, así que no pesa en el chunk de entrada.
 */
export const ROLE_LABELS = {
  admin: "Administrador/a",
  accountant: "Contador/a",
  assistant: "Asistente",
  client: "Contribuyente",
};

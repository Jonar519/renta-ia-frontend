/**
 * Quién puede entrar a cada ruta (guard del router, main.js). Es solo la
 * experiencia de usuario: la autorización real la hace la API (403/404),
 * aunque alguien manipule el rol guardado en el navegador.
 */

/** Nombre visible de cada rol (sin suponer género). */
export const ROLE_LABELS = {
  admin: "Administrador/a",
  accountant: "Contador/a",
  assistant: "Asistente",
  client: "Contribuyente",
};

const HOME = "/";

/**
 * @param {{ meta: { auth?: boolean, roles?: string[], label?: string } } | null} route  null = la ruta no existe
 * @param {{ hasSession: boolean, role?: string }} session
 * @returns {{ redirect: string, notice?: string } | null}  null = puede entrar
 */
export function decideRoute(route, { hasSession, role }) {
  if (!route) {
    return hasSession
      ? { redirect: HOME, notice: "La página que buscabas no existe. Te llevamos a Clientes." }
      : { redirect: "/login" };
  }
  const { auth, roles, label = "esa página" } = route.meta ?? {};
  if (auth && !hasSession) {
    return { redirect: "/login", notice: "Inicia sesión para continuar." };
  }
  if (roles && !roles.includes(role)) {
    const who = ROLE_LABELS[role] ? ` Tu rol (${ROLE_LABELS[role]}) no tiene acceso.` : "";
    return { redirect: HOME, notice: `No tienes permiso para ver "${label}".${who} Te llevamos a Clientes.` };
  }
  return null;
}

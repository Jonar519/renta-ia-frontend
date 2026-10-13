/**
 * Quién puede entrar a cada ruta (guard del router, main.js). Es solo la
 * experiencia de usuario: la autorización real la hace la API (403/404),
 * aunque alguien manipule el rol guardado en el navegador.
 *
 * Devuelve la DECISIÓN (adónde rebotar y por qué), no el texto: el aviso se
 * redacta en components/routeNotice.js, que se descarga solo cuando hay un
 * rebote. Así el chunk de entrada (presupuesto de 4 KB) no carga los textos.
 */
const HOME = "/";
const SECURITY = "/seguridad";

/**
 * @param {{ meta: { auth?: boolean, roles?: string[], label?: string } } | null} route  null = la ruta no existe
 * @param {{ hasSession: boolean, role?: string, mfaPending?: boolean }} session
 *   mfaPending = el rol exige MFA y la cuenta no lo tiene activo (admin): solo
 *   puede entrar a las rutas con meta.mfaSetup ("Seguridad").
 * @returns {{ redirect: string, notice?: { reason: "missing" | "login" | "forbidden" | "mfa", label?: string, role?: string } } | null}
 *   null = puede entrar
 */
export function decideRoute(route, { hasSession, role, mfaPending }) {
  if (!route) return hasSession ? { redirect: HOME, notice: { reason: "missing" } } : { redirect: "/login" };
  const { auth, roles, label, mfaSetup } = route.meta ?? {};
  if (auth && !hasSession) return { redirect: "/login", notice: { reason: "login" } };
  if (auth && mfaPending && !mfaSetup) return { redirect: SECURITY, notice: { reason: "mfa" } };
  if (roles && !roles.includes(role)) return { redirect: HOME, notice: { reason: "forbidden", label, role } };
  return null;
}

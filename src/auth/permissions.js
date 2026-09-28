import { getState } from "../state/store.js";

/**
 * Qué acciones muestra la interfaz según el rol. Es solo presentación: la
 * autorización real la hace la API (clientScope + role.middleware del
 * backend), que responde 403/404 aunque alguien fuerce el botón.
 *
 *  - admin / accountant: todo.
 *  - assistant: trabaja sobre los clientes de su contador, pero no los crea.
 *  - client (portal del contribuyente): solo lectura de su expediente.
 */
const RULES = {
  "client.create": ["admin", "accountant"],
  "document.write": ["admin", "accountant", "assistant"],
  "alert.update": ["admin", "accountant", "assistant"],
  "ai.use": ["admin", "accountant", "assistant"],
};

export function can(action, user = getState().user) {
  return Boolean(user && RULES[action]?.includes(user.role));
}

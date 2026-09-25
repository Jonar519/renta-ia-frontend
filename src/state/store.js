const listeners = new Set();

const state = {
  token: localStorage.getItem("renta_ia_token") || null,
  user: JSON.parse(localStorage.getItem("renta_ia_user") || "null"),
};

export function getState() {
  return state;
}

export function setAuth(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem("renta_ia_token", token);
  localStorage.setItem("renta_ia_user", JSON.stringify(user));
  notify();
}

export function clearAuth() {
  state.token = null;
  state.user = null;
  localStorage.removeItem("renta_ia_token");
  localStorage.removeItem("renta_ia_user");
  notify();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function notify() {
  listeners.forEach((fn) => fn(state));
}

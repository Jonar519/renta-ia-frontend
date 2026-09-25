import { authApi } from "../api/auth.api.js";
import { setAuth } from "../state/store.js";
import { showToast } from "../components/toast.js";

export function renderLogin(root) {
  root.innerHTML = `
    <div class="auth-screen">
      <div class="auth-card">
        <h1 class="auth-title">Renta IA</h1>
        <p class="auth-subtitle">Gestión documental contable para tus clientes, con IA que lee, extrae y avisa por ti.</p>

        <div class="auth-tabs">
          <button class="auth-tab is-active" data-tab="login" type="button">Iniciar sesión</button>
          <button class="auth-tab" data-tab="register" type="button">Crear cuenta</button>
        </div>

        <form id="login-form" class="auth-form">
          <label>Correo
            <input type="email" name="email" required autocomplete="email" />
          </label>
          <label>Contraseña
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <button type="submit" class="btn btn--primary btn--block">Entrar</button>
        </form>

        <form id="register-form" class="auth-form" hidden>
          <label>Nombre
            <input type="text" name="name" required autocomplete="name" />
          </label>
          <label>Correo
            <input type="email" name="email" required autocomplete="email" />
          </label>
          <label>Contraseña
            <input type="password" name="password" required minlength="8" autocomplete="new-password" />
          </label>
          <button type="submit" class="btn btn--primary btn--block">Crear cuenta</button>
        </form>
      </div>
    </div>
  `;

  const tabs = root.querySelectorAll(".auth-tab");
  const loginForm = root.querySelector("#login-form");
  const registerForm = root.querySelector("#register-form");

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((t) => t.classList.remove("is-active"));
      tab.classList.add("is-active");
      const isLogin = tab.dataset.tab === "login";
      loginForm.hidden = !isLogin;
      registerForm.hidden = isLogin;
    });
  });

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);

    try {
      const result = await authApi.login({
        email: formData.get("email"),
        password: formData.get("password"),
      });
      setAuth(result.token, result.user);
      showToast(`Bienvenido, ${result.user.name}`, "success");
      window.location.hash = "/";
    } catch (err) {
      showToast(err.message, "error");
    }
  });

  registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);

    try {
      const result = await authApi.register({
        name: formData.get("name"),
        email: formData.get("email"),
        password: formData.get("password"),
      });
      setAuth(result.token, result.user);
      showToast(`Cuenta creada. Bienvenido, ${result.user.name}`, "success");
      window.location.hash = "/";
    } catch (err) {
      showToast(err.message, "error");
    }
  });
}

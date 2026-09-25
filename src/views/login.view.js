import { authApi } from "../api/auth.api.js";
import { setAuth } from "../state/store.js";
import { showToast } from "../components/toast.js";
import { bindTabs } from "../components/tabs.js";

export function renderLogin(root) {
  root.innerHTML = `
    <main class="auth-screen" id="main-content" tabindex="-1">
      <div class="auth-card">
        <h1 class="auth-title">Renta IA</h1>
        <p class="auth-subtitle">Gestión documental contable para tus clientes, con IA que lee, extrae y avisa por ti.</p>

        <div class="auth-tabs" role="tablist" aria-label="Acceso">
          <button class="auth-tab" role="tab" id="tab-login" aria-controls="panel-login" aria-selected="true" type="button">Iniciar sesión</button>
          <button class="auth-tab" role="tab" id="tab-register" aria-controls="panel-register" aria-selected="false" type="button">Crear cuenta</button>
        </div>

        <div role="tabpanel" id="panel-login" aria-labelledby="tab-login">
        <form id="login-form" class="auth-form">
          <label>Correo
            <input type="email" name="email" required autocomplete="email" />
          </label>
          <label>Contraseña
            <input type="password" name="password" required autocomplete="current-password" />
          </label>
          <button type="submit" class="btn btn--primary btn--block">Entrar</button>
        </form>
        </div>

        <div role="tabpanel" id="panel-register" aria-labelledby="tab-register" hidden>
        <form id="register-form" class="auth-form">
          <label>Nombre
            <input type="text" name="name" required minlength="2" maxlength="150" autocomplete="name" />
          </label>
          <label>Correo
            <input type="email" name="email" required autocomplete="email" />
          </label>
          <label>Contraseña
            <input type="password" name="password" required minlength="8" maxlength="72" autocomplete="new-password" />
          </label>
          <button type="submit" class="btn btn--primary btn--block">Crear cuenta</button>
        </form>
        </div>
      </div>
    </main>
  `;

  const loginForm = root.querySelector("#login-form");
  const registerForm = root.querySelector("#register-form");

  bindTabs(root);

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

import { aiApi } from "../../api/ai.api.js";

export function chatPanelHtml() {
  return `
    <section class="panel panel--chat">
      <h2>Pregúntale a la IA sobre este cliente</h2>
      <div class="chat-log" id="chat-log" role="log" aria-live="polite" aria-label="Conversación con el asistente de IA">
        <p class="chat-empty">Hazle una pregunta sobre los documentos de este cliente. Por ejemplo: "¿Cuál fue el ingreso bruto reportado?"</p>
      </div>
      <form id="chat-form" class="chat-form" data-requires-network>
        <label for="chat-question" class="visually-hidden">Tu pregunta sobre este cliente</label>
        <input type="text" id="chat-question" name="question" placeholder="Escribe tu pregunta..." required minlength="3" maxlength="1000" />
        <button type="submit" class="btn btn--primary">Preguntar</button>
      </form>
    </section>
  `;
}

function appendChatMessage(logEl, role, text, pending = false) {
  logEl.querySelector(".chat-empty")?.remove();
  const wrapper = document.createElement("div");
  wrapper.className = `chat-message chat-message--${role}${pending ? " chat-message--pending" : ""}`;
  const bubble = document.createElement("div");
  bubble.className = "chat-bubble";
  bubble.textContent = text;
  wrapper.appendChild(bubble);
  logEl.appendChild(wrapper);
  logEl.scrollTop = logEl.scrollHeight;
  return wrapper;
}

export function createChatSection(root, clientId) {
  const chatForm = root.querySelector("#chat-form");
  const chatLog = root.querySelector("#chat-log");

  chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = chatForm.question;
    const question = input.value.trim();
    if (!question) return;

    appendChatMessage(chatLog, "user", question);
    input.value = "";
    input.disabled = true;
    const pendingEl = appendChatMessage(chatLog, "assistant", "Pensando...", true);

    try {
      const result = await aiApi.chat(clientId, question);
      pendingEl.querySelector(".chat-bubble").textContent = result.answer;
      pendingEl.classList.remove("chat-message--pending");
    } catch (err) {
      pendingEl.querySelector(".chat-bubble").textContent = `No se pudo responder: ${err.message}`;
      pendingEl.classList.remove("chat-message--pending");
      pendingEl.classList.add("chat-message--error");
    } finally {
      input.disabled = false;
      input.focus();
    }
  });
}

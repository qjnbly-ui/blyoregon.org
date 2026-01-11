(function () {
  const slot = document.querySelector(".bly-chat-slot");
  if (!slot) return;
  if (slot.querySelector(".bly-chat")) return;

  const widget = document.createElement("div");
  widget.className = "bly-chat embed";
  widget.dataset.open = "false";
  widget.innerHTML = `
    <div class="bly-chat-overlay" aria-hidden="true">
      <div class="bly-chat-panel" role="dialog" aria-modal="true" aria-label="Ask Bly">
        <div class="bly-chat-header">
          <div>
            <strong>Bly</strong>
            <span>Ask about our town history</span>
          </div>
          <button class="bly-chat-close" type="button" aria-label="Close chat">&times;</button>
        </div>
        <div class="bly-chat-messages" role="log" aria-live="polite"></div>
        <form class="bly-chat-form">
          <input type="text" name="question" placeholder="Ask Bly something..." autocomplete="off" required>
          <button type="submit">Send</button>
        </form>
        <p class="bly-chat-note">Bly answers using the stories and pages on this site.</p>
      </div>
    </div>
    <button class="bly-chat-toggle" type="button" aria-expanded="false">Ask Bly</button>
  `;

  slot.appendChild(widget);

  const toggle = widget.querySelector(".bly-chat-toggle");
  const closeBtn = widget.querySelector(".bly-chat-close");
  const overlay = widget.querySelector(".bly-chat-overlay");
  const panel = widget.querySelector(".bly-chat-panel");
  const form = widget.querySelector(".bly-chat-form");
  const input = widget.querySelector(".bly-chat-form input");
  const messages = widget.querySelector(".bly-chat-messages");
  const storageKey = "blyChatHistory";
  let history = [];
  let usingViewportFix = false;

  try {
    history = JSON.parse(sessionStorage.getItem(storageKey)) || [];
  } catch (err) {
    history = [];
  }

  function setOpen(isOpen) {
    widget.dataset.open = isOpen ? "true" : "false";
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    overlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    document.documentElement.style.overflow = isOpen ? "hidden" : "";
    if (isOpen) {
      input.focus();
    }
  }

  function applyViewportFix() {
    if (!window.visualViewport) return;
    usingViewportFix = true;
    const height = window.visualViewport.height;
    panel.style.height = `${Math.max(height - 24, 320)}px`;
  }

  function clearViewportFix() {
    if (!usingViewportFix) return;
    panel.style.height = "";
    usingViewportFix = false;
  }

  function saveHistory() {
    sessionStorage.setItem(storageKey, JSON.stringify(history));
  }

  function addMessage(text, type, shouldStore = true) {
    const message = document.createElement("div");
    message.className = `bly-chat-message ${type}`;
    message.textContent = text;
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
    if (shouldStore) {
      const role = type === "user" ? "user" : "assistant";
      history.push({ role, content: text });
      history = history.slice(-12);
      saveHistory();
    }
  }

  if (history.length) {
    history.forEach((entry) => {
      const type = entry.role === "user" ? "user" : "bly";
      addMessage(entry.content, type, false);
    });
  }

  toggle.addEventListener("click", () => setOpen(widget.dataset.open !== "true"));
  closeBtn.addEventListener("click", () => setOpen(false));
  input.addEventListener("focus", applyViewportFix);
  input.addEventListener("blur", clearViewportFix);

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", applyViewportFix);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    addMessage(question, "user");
    input.value = "";
    input.disabled = true;
    form.querySelector("button").disabled = true;

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, history }),
      });
      const data = await response.json();
      const answer = data.answer || data.error || "I do not know that yet.";
      addMessage(answer, "bly");
    } catch (error) {
      addMessage("Sorry, I could not reach the storyteller right now.", "bly");
    } finally {
      input.disabled = false;
      form.querySelector("button").disabled = false;
      input.focus();
    }
  });
})();

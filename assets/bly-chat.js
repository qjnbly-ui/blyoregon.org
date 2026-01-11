(function () {
  if (document.querySelector(".bly-chat")) return;

  const widget = document.createElement("div");
  widget.className = "bly-chat";
  widget.dataset.open = "false";
  widget.innerHTML = `
    <div class="bly-chat-panel" aria-hidden="true">
      <div class="bly-chat-header">
        <div>
          <strong>Bly</strong>
          <span>Ask about our town history</span>
        </div>
        <button class="bly-chat-close" type="button" aria-label="Close chat">Close</button>
      </div>
      <div class="bly-chat-messages" role="log" aria-live="polite"></div>
      <form class="bly-chat-form">
        <input type="text" name="question" placeholder="Ask Bly something..." autocomplete="off" required>
        <button type="submit">Send</button>
      </form>
      <p class="bly-chat-note">Bly answers using the stories and pages on this site.</p>
    </div>
    <button class="bly-chat-toggle" type="button" aria-expanded="false">Ask Bly</button>
  `;

  document.body.appendChild(widget);

  const toggle = widget.querySelector(".bly-chat-toggle");
  const closeBtn = widget.querySelector(".bly-chat-close");
  const panel = widget.querySelector(".bly-chat-panel");
  const form = widget.querySelector(".bly-chat-form");
  const input = widget.querySelector(".bly-chat-form input");
  const messages = widget.querySelector(".bly-chat-messages");
  const storageKey = "blyChatHistory";
  let history = [];

  try {
    history = JSON.parse(sessionStorage.getItem(storageKey)) || [];
  } catch (err) {
    history = [];
  }

  function setOpen(isOpen) {
    widget.dataset.open = isOpen ? "true" : "false";
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    panel.setAttribute("aria-hidden", isOpen ? "false" : "true");
    if (isOpen) {
      input.focus();
    }
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

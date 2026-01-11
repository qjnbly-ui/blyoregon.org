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
          <div class="bly-chat-header-title">
            <strong>Bly</strong>
            <span>Ask about our town history</span>
          </div>
          <div class="bly-chat-header-actions">
            <button class="bly-chat-voice" type="button" aria-pressed="false" aria-label="Toggle voice">🔈</button>
            <button class="bly-chat-play" type="button" aria-label="Play selected text" disabled>▶︎</button>
            <button class="bly-chat-stop" type="button" aria-label="Stop audio">⏹</button>
            <button class="bly-chat-close" type="button" aria-label="Close chat">&times;</button>
          </div>
        </div>
        <div class="bly-chat-messages" role="log" aria-live="polite"></div>
        <form class="bly-chat-form">
          <input type="text" name="question" placeholder="Ask Bly something..." autocomplete="off" required>
          <button class="bly-chat-mic" type="button" aria-pressed="false" aria-label="Use voice input">🎤</button>
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
  const voiceBtn = widget.querySelector(".bly-chat-voice");
  const playBtn = widget.querySelector(".bly-chat-play");
  const stopBtn = widget.querySelector(".bly-chat-stop");
  const micBtn = widget.querySelector(".bly-chat-mic");
  const overlay = widget.querySelector(".bly-chat-overlay");
  const panel = widget.querySelector(".bly-chat-panel");
  const form = widget.querySelector(".bly-chat-form");
  const input = widget.querySelector(".bly-chat-form input");
  const messages = widget.querySelector(".bly-chat-messages");
  const storageKey = "blyChatHistory";
  const nameKey = "blyChatUserName";
  let history = [];
  let userName = sessionStorage.getItem(nameKey) || "";
  let usingViewportFix = false;
  let voiceEnabled = false;
  let recognition = null;

  try {
    history = JSON.parse(sessionStorage.getItem(storageKey)) || [];
  } catch (err) {
    history = [];
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (SpeechRecognition) {
    recognition = new SpeechRecognition();
    recognition.lang = "en-US";
    recognition.interimResults = false;
  } else {
    micBtn.disabled = true;
    micBtn.title = "Voice input not supported";
  }

  if (!window.speechSynthesis) {
    voiceBtn.disabled = true;
    voiceBtn.title = "Voice output not supported";
    stopBtn.disabled = true;
    playBtn.disabled = true;
  }

  function setOpen(isOpen) {
    widget.dataset.open = isOpen ? "true" : "false";
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
    overlay.setAttribute("aria-hidden", isOpen ? "false" : "true");
    document.documentElement.style.overflow = isOpen ? "hidden" : "";
    if (isOpen) {
      input.focus();
      if (history.length === 0 && !userName) {
        const greeting = "Hello—I’m Bly. I’m a small town with deep roots, and I keep my stories in these pages. What’s your full name?";
        addMessage(greeting, "bly");
      }
    } else {
      if (recognition) recognition.stop();
      if (window.speechSynthesis) window.speechSynthesis.cancel();
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

  function speak(text) {
    if (!voiceEnabled || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
  }

  function getSelectedText() {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return "";
    const text = selection.toString().trim();
    if (!text) return "";
    if (!panel.contains(selection.anchorNode) || !panel.contains(selection.focusNode)) return "";
    return text;
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
  voiceBtn.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceBtn.setAttribute("aria-pressed", voiceEnabled ? "true" : "false");
    voiceBtn.textContent = voiceEnabled ? "🔊" : "🔈";
    voiceBtn.classList.toggle("is-active", voiceEnabled);
  });

  stopBtn.addEventListener("click", () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
  });

  playBtn.addEventListener("click", () => {
    const selected = getSelectedText();
    if (!selected) return;
    if (!voiceEnabled) {
      voiceEnabled = true;
      voiceBtn.setAttribute("aria-pressed", "true");
      voiceBtn.textContent = "🔊";
      voiceBtn.classList.add("is-active");
    }
    speak(selected);
  });

  if (recognition) {
    recognition.addEventListener("result", (event) => {
      const transcript = event.results[0]?.[0]?.transcript || "";
      if (transcript) {
        input.value = transcript.trim();
        input.focus();
      }
    });

    recognition.addEventListener("end", () => {
      micBtn.setAttribute("aria-pressed", "false");
      micBtn.classList.remove("is-listening");
    });

    micBtn.addEventListener("click", () => {
      if (micBtn.getAttribute("aria-pressed") === "true") {
        recognition.stop();
        return;
      }
      micBtn.setAttribute("aria-pressed", "true");
      micBtn.classList.add("is-listening");
      recognition.start();
    });
  }

  document.addEventListener("selectionchange", () => {
    const selected = getSelectedText();
    if (!window.speechSynthesis) return;
    playBtn.disabled = !selected;
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", applyViewportFix);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    const nameSubmission = !userName && question.split(/\s+/).filter(Boolean).length >= 2;
    if (nameSubmission) {
      userName = question;
      sessionStorage.setItem(nameKey, userName);
    }

    addMessage(question, "user");
    input.value = "";
    input.disabled = true;
    form.querySelector("button").disabled = true;

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          history,
          userName,
          nameSubmission,
        }),
      });
      const data = await response.json();
      const answer = data.answer || data.error || "I do not know that yet.";
      addMessage(answer, "bly");
      speak(answer);
    } catch (error) {
      addMessage("Sorry, I could not reach the storyteller right now.", "bly");
    } finally {
      input.disabled = false;
      form.querySelector("button").disabled = false;
      input.focus();
    }
  });
})();

(function () {
  const slot = document.querySelector(".bly-chat-slot");
  if (!slot) return;
  if (slot.querySelector(".bly-chat")) return;

  const path = window.location.pathname.replace(/\/index\.html$/, "/");
  const isHomePage = path === "/" || path === "";
  if (isHomePage) {
    const link = document.createElement("a");
    link.className = "bly-chat-toggle";
    link.href = "/askbly/";
    link.textContent = "Ask Bly";
    slot.appendChild(link);
    return;
  }

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
  const limitKey = "blyChatCount";
  const introKey = "blyChatIntroShown";
  const responseLimit = 20;
  let history = [];
  let responseCount = Number(sessionStorage.getItem(limitKey) || 0);
  let introShown = sessionStorage.getItem(introKey) === "true";
  let usingViewportFix = false;
  let voiceEnabled = false;
  let recognition = null;
  let ttsSession = 0;
  let currentAudio = null;

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

  if (!window.Audio) {
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
      if (history.length === 0 && !introShown) {
        const greeting =
          "Hi, I’m Bly. I speak from our town’s records—people, places, and history. " +
          "If you want, you can tell me your name and I’ll keep things a little more personal—or we can just talk about Bly. " +
          "We can do a few things here. I can point you to places that are open now, share stories from the past, or help track down something specific you’ve heard about. Where do you want to start?";
        addMessage(greeting, "bly");
        introShown = true;
        sessionStorage.setItem(introKey, "true");
      }
    } else {
      if (recognition) recognition.stop();
      ttsSession += 1;
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
      }
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

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function normalizeDomains(value) {
    return value.replace(/\b([a-z0-9][a-z0-9-]*)\s*\.\s*([a-z]{2,})\b/gi, "$1.$2");
  }

  function linkifyText(value) {
    const normalized = normalizeDomains(value);
    let html = escapeHtml(normalized);

    html = html.replace(
      /\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/gi,
      '<a href="mailto:$1">$1</a>'
    );

    html = html.replace(
      /\bhttps?:\/\/[^\s<]+/gi,
      (match) => `<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>`
    );

    html = html.replace(
      /\b([a-z0-9][a-z0-9-]*\.[a-z]{2,}(?:\/[^\s<]*)?)\b/gi,
      (match) => `<a href="https://${match}" target="_blank" rel="noopener noreferrer">${match}</a>`
    );

    html = html.replace(
      /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g,
      (match) => {
        const digits = match.replace(/[^\d]/g, "");
        const tel = digits.length === 10 ? `+1${digits}` : `+${digits}`;
        return `<a href="tel:${tel}">${match}</a>`;
      }
    );

    return html;
  }

  function addMessage(text, type, shouldStore = true) {
    const message = document.createElement("div");
    message.className = `bly-chat-message ${type}`;
    if (type === "bly") {
      message.innerHTML = linkifyText(text);
    } else {
      message.textContent = text;
    }
    messages.appendChild(message);
    messages.scrollTop = messages.scrollHeight;
    if (shouldStore) {
      const role = type === "user" ? "user" : "assistant";
      history.push({ role, content: text });
      history = history.slice(-12);
      saveHistory();
    }
  }

  function splitTtsText(text, maxLen = 200) {
    const cleaned = text.replace(/\s+/g, " ").trim();
    if (!cleaned) return [];
    const words = cleaned.split(" ");
    const chunks = [];
    let current = "";

    words.forEach((word) => {
      if ((current + " " + word).trim().length <= maxLen) {
        current = (current + " " + word).trim();
      } else {
        if (current) chunks.push(current);
        current = word;
      }
    });

    if (current) chunks.push(current);
    return chunks;
  }

  async function fetchTtsAudio(text) {
    const response = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!response.ok) {
      throw new Error("TTS request failed");
    }
    const buffer = await response.arrayBuffer();
    return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
  }

  async function playAudio(url, sessionId) {
    return new Promise((resolve) => {
      const audio = new Audio(url);
      currentAudio = audio;
      audio.onended = () => {
        if (currentAudio === audio) currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      audio.onerror = () => {
        if (currentAudio === audio) currentAudio = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      if (sessionId !== ttsSession) {
        URL.revokeObjectURL(url);
        resolve();
        return;
      }
      audio.play().catch(() => resolve());
    });
  }

  async function speak(text) {
    if (!voiceEnabled) return;
    const chunks = splitTtsText(text);
    if (!chunks.length) return;
    ttsSession += 1;
    const sessionId = ttsSession;

    const fetchPromises = chunks.map((chunk) => fetchTtsAudio(chunk));
    for (let i = 0; i < fetchPromises.length; i += 1) {
      if (sessionId !== ttsSession) return;
      try {
        const url = await fetchPromises[i];
        if (sessionId !== ttsSession) return;
        await playAudio(url, sessionId);
      } catch (error) {
        return;
      }
    }
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
    ttsSession += 1;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
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
    playBtn.disabled = !selected;
  });

  if (window.visualViewport) {
    window.visualViewport.addEventListener("resize", applyViewportFix);
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const question = input.value.trim();
    if (!question) return;

    if (responseCount >= responseLimit) {
      addMessage(
        "This is an experiment with a custom-built AI for Bly, Oregon. We’re still in development, and to keep costs down we have a per-session limit. You’ve reached that limit—please come back another time.",
        "bly"
      );
      return;
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
        }),
      });
      const data = await response.json();
      const answer = data.answer || data.error || "I do not know that yet.";
      addMessage(answer, "bly");
      speak(answer);
      responseCount += 1;
      sessionStorage.setItem(limitKey, String(responseCount));
    } catch (error) {
      addMessage("Sorry, I could not reach the storyteller right now.", "bly");
    } finally {
      input.disabled = false;
      form.querySelector("button").disabled = false;
      input.focus();
    }
  });
})();

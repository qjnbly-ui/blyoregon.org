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
            <span class="bly-chat-status">Memory: saved on this device</span>
          </div>
          <div class="bly-chat-header-actions">
            <button class="bly-chat-voice" type="button" aria-pressed="false" aria-label="Toggle voice replies">
              <span class="bly-chat-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" role="img" focusable="false" aria-hidden="true">
                  <path d="M4 10v4h4l5 4V6L8 10H4zm12.5 2c0-1.8-1-3.4-2.5-4.2v8.4c1.5-.8 2.5-2.4 2.5-4.2zm2.5 0c0 3-1.7 5.6-4.2 6.9v-2.3c1.4-1 2.2-2.6 2.2-4.6s-.8-3.6-2.2-4.6V5.1c2.5 1.3 4.2 3.9 4.2 6.9z" />
                </svg>
              </span>
              <span class="bly-chat-label">Voice Reply: Off</span>
            </button>
            <button class="bly-chat-clear" type="button">Clear chat</button>
            <button class="bly-chat-close" type="button" aria-label="Close chat">&times;</button>
          </div>
        </div>
        <div class="bly-chat-messages" role="log" aria-live="polite"></div>
        <form class="bly-chat-form">
          <input type="text" name="question" placeholder="Ask Bly something..." autocomplete="off" required>
          <button class="bly-chat-mic" type="button" aria-pressed="false" aria-label="Speak">
            <span class="bly-chat-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" role="img" focusable="false" aria-hidden="true">
                <path d="M12 14a3 3 0 0 0 3-3V6a3 3 0 1 0-6 0v5a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V20h2v-2.1A7 7 0 0 0 19 11h-2z" />
              </svg>
            </span>
            <span class="bly-chat-label">Speak</span>
          </button>
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
  const clearBtn = widget.querySelector(".bly-chat-clear");
  const micBtn = widget.querySelector(".bly-chat-mic");
  const voiceLabel = widget.querySelector(".bly-chat-voice .bly-chat-label");
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
  let activeControls = null;

  try {
    history = JSON.parse(localStorage.getItem(storageKey)) || [];
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
      if (activeControls) {
        activeControls.stopBtn.hidden = true;
        activeControls.listenBtn.hidden = false;
        activeControls.progress.hidden = true;
        activeControls.progress.value = 0;
        activeControls = null;
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
    localStorage.setItem(storageKey, JSON.stringify(history));
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  const tldList = "(?:com|org|net|edu|gov|us|io|co|biz|info|me|tv|ai|app|dev|ca|uk|au|nz)";
  const spacedDomainRegex = new RegExp(`\\b([a-z0-9][a-z0-9-]*)\\s*\\.\\s*(${tldList})\\b`, "gi");
  const urlRegex = /\bhttps?:\/\/[^\s<]+/gi;
  const emailRegex = /\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi;
  const domainRegex = new RegExp(`\\b[a-z0-9][a-z0-9-]*\\.${tldList}(?:\\/[^\\s<]*)?\\b`, "gi");
  const phoneRegex = /\b(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g;

  function normalizeDomains(value) {
    return value.replace(spacedDomainRegex, "$1.$2");
  }

  function linkifyText(value) {
    const normalized = normalizeDomains(value);
    const escaped = escapeHtml(normalized);
    const combined = new RegExp(
      `${urlRegex.source}|${emailRegex.source}|${domainRegex.source}|${phoneRegex.source}`,
      "gi"
    );

    return escaped.replace(combined, (match) => {
      if (urlRegex.test(match)) {
        urlRegex.lastIndex = 0;
        return `<a href="${match}" target="_blank" rel="noopener noreferrer">${match}</a>`;
      }
      if (emailRegex.test(match)) {
        emailRegex.lastIndex = 0;
        return `<a href="mailto:${match}">${match}</a>`;
      }
      if (domainRegex.test(match)) {
        domainRegex.lastIndex = 0;
        return `<a href="https://${match}" target="_blank" rel="noopener noreferrer">${match}</a>`;
      }
      if (phoneRegex.test(match)) {
        phoneRegex.lastIndex = 0;
        const digits = match.replace(/[^\d]/g, "");
        const tel = digits.length === 10 ? `+1${digits}` : `+${digits}`;
        return `<a href="tel:${tel}">${match}</a>`;
      }
      return match;
    });
  }

  function addMessage(text, type, shouldStore = true) {
    const message = document.createElement("div");
    message.className = `bly-chat-message ${type}`;
    const textEl = document.createElement("p");
    textEl.className = "bly-chat-message-text";
    if (type === "bly") {
      textEl.innerHTML = linkifyText(text);
    } else {
      textEl.textContent = text;
    }
    message.appendChild(textEl);

    if (type === "bly") {
      const controls = document.createElement("div");
      controls.className = "bly-chat-message-controls";
      const listenBtn = document.createElement("button");
      listenBtn.type = "button";
      listenBtn.className = "bly-chat-tts";
      listenBtn.textContent = "Listen";
      const stopBtn = document.createElement("button");
      stopBtn.type = "button";
      stopBtn.className = "bly-chat-tts-stop";
      stopBtn.textContent = "Stop";
      stopBtn.hidden = true;
      const progress = document.createElement("progress");
      progress.className = "bly-chat-tts-progress";
      progress.max = 1;
      progress.value = 0;
      progress.hidden = true;
      controls.appendChild(listenBtn);
      controls.appendChild(stopBtn);
      controls.appendChild(progress);
      message.appendChild(controls);
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
    const sentences = cleaned.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [cleaned];
    const chunks = [];
    let current = "";

    function splitByPunctuation(sentenceText) {
      const parts = sentenceText
        .split(/([,;:])/)
        .reduce((acc, part, idx, arr) => {
          if (idx % 2 === 0) {
            const nextPunct = arr[idx + 1] || "";
            acc.push(`${part}${nextPunct}`.trim());
          }
          return acc;
        }, [])
        .filter(Boolean);
      return parts.length ? parts : [sentenceText];
    }

    sentences.forEach((sentence) => {
      const trimmed = sentence.trim();
      if (!trimmed) return;
      if ((current + " " + trimmed).trim().length <= maxLen) {
        current = (current + " " + trimmed).trim();
        return;
      }
      if (current) chunks.push(current);
      if (trimmed.length <= maxLen) {
        current = trimmed;
        return;
      }
      const subparts = splitByPunctuation(trimmed);
      let part = "";
      subparts.forEach((subpart) => {
        if ((part + " " + subpart).trim().length <= maxLen) {
          part = (part + " " + subpart).trim();
          return;
        }
        if (part) chunks.push(part);
        if (subpart.length <= maxLen) {
          part = subpart;
          return;
        }
        const words = subpart.split(" ");
        let wordPart = "";
        words.forEach((word) => {
          if ((wordPart + " " + word).trim().length <= maxLen) {
            wordPart = (wordPart + " " + word).trim();
          } else {
            if (wordPart) chunks.push(wordPart);
            wordPart = word;
          }
        });
        if (wordPart) chunks.push(wordPart);
        part = "";
      });
      if (part) chunks.push(part);
      current = "";
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

  function formatDomainForTts(domain) {
    return domain.replace(/\./g, " dot ");
  }

  function prepareTtsText(text) {
    let out = text;
    out = out.replace(/\bRd\b/g, "Road");
    out = out.replace(/\bOR\b/g, "Oregon");
    out = out.replace(/\b(\d{5})\b/g, (match, digits) => digits.split("").join(" "));
    out = out.replace(/\b100\b/g, "one hundred");
    out = out.replace(/\bKness\b/g, "Ness");
    out = out.replace(/\b(18|19|20)(\d{2})\b/g, (match, century, year) => {
      const centuryMap = { "18": "eighteen", "19": "nineteen", "20": "twenty" };
      const tensMap = {
        "0": "oh",
        "1": "ten",
        "2": "twenty",
        "3": "thirty",
        "4": "forty",
        "5": "fifty",
        "6": "sixty",
        "7": "seventy",
        "8": "eighty",
        "9": "ninety",
      };
      const onesMap = {
        "0": "",
        "1": "one",
        "2": "two",
        "3": "three",
        "4": "four",
        "5": "five",
        "6": "six",
        "7": "seven",
        "8": "eight",
        "9": "nine",
      };
      const tens = year[0];
      const ones = year[1];
      if (tens === "0") {
        return `${centuryMap[century]} oh ${onesMap[ones]}`.trim();
      }
      if (tens === "1") {
        const teenMap = {
          "0": "ten",
          "1": "eleven",
          "2": "twelve",
          "3": "thirteen",
          "4": "fourteen",
          "5": "fifteen",
          "6": "sixteen",
          "7": "seventeen",
          "8": "eighteen",
          "9": "nineteen",
        };
        return `${centuryMap[century]} ${teenMap[ones]}`.trim();
      }
      const tensWord = tensMap[tens];
      const onesWord = onesMap[ones];
      return `${centuryMap[century]} ${tensWord}${onesWord ? ` ${onesWord}` : ""}`.trim();
    });
    out = normalizeDomains(out);
    out = out.replace(
      /\bhttps?:\/\/(?:www\.)?([a-z0-9.-]+)(?:\/\S*)?/gi,
      (match, domain) => formatDomainForTts(domain)
    );
    out = out.replace(
      /\b([a-z0-9.-]+\.[a-z]{2,})\b/gi,
      (match) => formatDomainForTts(match)
    );
    return out;
  }

  async function speak(text, controls = null) {
    if (!voiceEnabled && !controls) return;
    const prepared = prepareTtsText(text);
    const chunks = splitTtsText(prepared);
    if (!chunks.length) return;
    ttsSession += 1;
    const sessionId = ttsSession;
    const total = chunks.length;
    let completed = 0;

    if (controls) {
      const { listenBtn, stopBtn, progress } = controls;
      if (activeControls && activeControls !== controls) {
        activeControls.stopBtn.hidden = true;
        activeControls.listenBtn.hidden = false;
        activeControls.progress.hidden = true;
        activeControls.progress.value = 0;
      }
      activeControls = controls;
      listenBtn.hidden = true;
      stopBtn.hidden = false;
      progress.hidden = false;
      progress.value = 0;
    }

    const fetchPromises = chunks.map((chunk) => fetchTtsAudio(chunk));
    for (let i = 0; i < fetchPromises.length; i += 1) {
      if (sessionId !== ttsSession) return;
      try {
        const url = await fetchPromises[i];
        if (sessionId !== ttsSession) return;
        await playAudio(url, sessionId);
        completed += 1;
        if (controls) {
          controls.progress.value = total ? completed / total : 1;
        }
      } catch (error) {
        break;
      }
    }

    if (controls && activeControls === controls) {
      controls.stopBtn.hidden = true;
      controls.listenBtn.hidden = false;
      controls.progress.hidden = true;
      controls.progress.value = 0;
      activeControls = null;
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
  voiceBtn.addEventListener("click", () => {
    voiceEnabled = !voiceEnabled;
    voiceBtn.setAttribute("aria-pressed", voiceEnabled ? "true" : "false");
    if (voiceLabel) {
      voiceLabel.textContent = voiceEnabled ? "Voice Reply: On" : "Voice Reply: Off";
    }
    voiceBtn.classList.toggle("is-active", voiceEnabled);
  });

  clearBtn.addEventListener("click", () => {
    history = [];
    saveHistory();
    messages.innerHTML = "";
    introShown = false;
    sessionStorage.removeItem(introKey);
    ttsSession += 1;
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      currentAudio = null;
    }
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

  messages.addEventListener("click", (event) => {
    const listenBtn = event.target.closest(".bly-chat-tts");
    const stopBtn = event.target.closest(".bly-chat-tts-stop");
    if (!listenBtn && !stopBtn) return;
    const bubble = event.target.closest(".bly-chat-message.bly");
    if (!bubble) return;
    const text = bubble.querySelector(".bly-chat-message-text")?.textContent || "";
    const controls = {
      listenBtn: bubble.querySelector(".bly-chat-tts"),
      stopBtn: bubble.querySelector(".bly-chat-tts-stop"),
      progress: bubble.querySelector(".bly-chat-tts-progress"),
    };
    if (stopBtn) {
      ttsSession += 1;
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.currentTime = 0;
        currentAudio = null;
      }
      if (controls) {
        controls.stopBtn.hidden = true;
        controls.listenBtn.hidden = false;
        controls.progress.hidden = true;
        controls.progress.value = 0;
        if (activeControls === controls) activeControls = null;
      }
      return;
    }
    speak(text, controls);
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

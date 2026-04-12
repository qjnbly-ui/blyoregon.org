(function () {
  const STYLE_ID = "oral-history-audio-styles";

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .oral-history-audio {
        display: grid;
        gap: 0.8rem;
        padding: 0.95rem;
        border-radius: 18px;
        border: 1px solid rgba(31, 64, 48, 0.12);
        background: linear-gradient(180deg, rgba(255, 255, 255, 0.98), rgba(245, 239, 229, 0.92));
        box-shadow: 0 16px 34px rgba(12, 26, 20, 0.12);
      }

      .oral-history-audio__primary,
      .oral-history-audio__secondary,
      .oral-history-audio__speed {
        appearance: none;
        border-radius: 999px;
        font: inherit;
        font-weight: 700;
      }

      .oral-history-audio__controls {
        display: flex;
        gap: 0.6rem;
        align-items: center;
        flex-wrap: wrap;
        justify-content: center;
      }

      .oral-history-audio__primary,
      .oral-history-audio__secondary {
        border: 0;
        cursor: pointer;
        min-height: 3rem;
      }

      .oral-history-audio__primary {
        padding: 0.74rem 1rem;
        background: linear-gradient(135deg, #143227, #2f5a46);
        color: #fff;
        min-width: 7.5rem;
      }

      .oral-history-audio__secondary {
        padding: 0.7rem 0.88rem;
        background: rgba(255, 255, 255, 0.92);
        color: #143227;
        border: 1px solid rgba(20, 50, 39, 0.14);
      }

      .oral-history-audio__speed {
        border: 1px solid rgba(20, 50, 39, 0.14);
        background: rgba(255, 255, 255, 0.92);
        color: #143227;
        padding: 0.7rem 0.9rem;
        cursor: pointer;
        min-height: 2.75rem;
        min-width: 5.75rem;
        text-align: center;
      }

      .oral-history-audio__timeline {
        display: grid;
        gap: 0.5rem;
        width: min(100%, 720px);
        margin: 0 auto;
      }

      .oral-history-audio__time-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 1rem;
        font-size: 0.9rem;
        color: #4d5f56;
        font-variant-numeric: tabular-nums;
      }

      .oral-history-audio__range {
        width: 100%;
        accent-color: #2f5a46;
        cursor: pointer;
      }

      @media (max-width: 720px) {
        .oral-history-audio {
          padding: 0.85rem;
        }

        .oral-history-audio__download,
        .oral-history-audio__primary,
        .oral-history-audio__secondary,
        .oral-history-audio__speed {
          width: 100%;
          justify-content: center;
        }

        .oral-history-audio__controls {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }

        .oral-history-audio__primary {
          grid-column: 1 / -1;
        }

        .oral-history-audio__speed {
          grid-column: 1 / -1;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function formatTime(value) {
    if (!Number.isFinite(value) || value < 0) return "0:00";
    const totalSeconds = Math.floor(value);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, "0")}`;
  }

  function clampTime(audio, nextValue) {
    const duration = Number.isFinite(audio.duration) ? audio.duration : nextValue;
    return Math.max(0, Math.min(nextValue, duration || nextValue));
  }

  function enhancePlayer(container) {
    const audio = container.querySelector("audio");
    if (!audio || container.dataset.enhanced === "true") return;
    container.dataset.enhanced = "true";
    ensureStyles();

    const source = audio.querySelector("source");
    const src = audio.currentSrc || source?.src || audio.getAttribute("src") || "";
    const downloadName = container.dataset.downloadName || "";

    audio.removeAttribute("controls");
    audio.preload = "metadata";
    audio.style.display = "none";

    const shell = document.createElement("div");
    shell.className = "oral-history-audio";

    const controls = document.createElement("div");
    controls.className = "oral-history-audio__controls";

    const playButton = document.createElement("button");
    playButton.type = "button";
    playButton.className = "oral-history-audio__primary";
    playButton.textContent = "Play interview";

    const backButton = document.createElement("button");
    backButton.type = "button";
    backButton.className = "oral-history-audio__secondary";
    backButton.textContent = "-15s";

    const forwardButton = document.createElement("button");
    forwardButton.type = "button";
    forwardButton.className = "oral-history-audio__secondary";
    forwardButton.textContent = "+15s";

    const speeds = [1, 1.25, 1.5, 1.75, 2];
    let speedIndex = 0;
    const speed = document.createElement("button");
    speed.type = "button";
    speed.className = "oral-history-audio__speed";
    speed.textContent = "1x";

    controls.append(playButton, backButton, forwardButton, speed);

    const timeline = document.createElement("div");
    timeline.className = "oral-history-audio__timeline";

    const range = document.createElement("input");
    range.className = "oral-history-audio__range";
    range.type = "range";
    range.min = "0";
    range.max = "100";
    range.step = "0.1";
    range.value = "0";

    const timeRow = document.createElement("div");
    timeRow.className = "oral-history-audio__time-row";

    const elapsed = document.createElement("span");
    elapsed.textContent = "0:00";
    const remaining = document.createElement("span");
    remaining.textContent = "0:00 total";

    timeRow.append(elapsed, remaining);
    timeline.append(range, timeRow);

    shell.append(controls, timeline);
    audio.insertAdjacentElement("afterend", shell);

    function syncUi() {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      const currentTime = Number.isFinite(audio.currentTime) ? audio.currentTime : 0;
      range.value = duration ? String((currentTime / duration) * 100) : "0";
      elapsed.textContent = formatTime(currentTime);
      remaining.textContent = duration ? `${formatTime(duration)} total` : "Loading length...";
      playButton.textContent = audio.paused ? "Play interview" : "Pause interview";
    }

    playButton.addEventListener("click", async () => {
      try {
        if (audio.paused) await audio.play();
        else audio.pause();
      } catch (_error) {
      }
      syncUi();
    });

    backButton.addEventListener("click", () => {
      audio.currentTime = clampTime(audio, audio.currentTime - 15);
      syncUi();
    });

    forwardButton.addEventListener("click", () => {
      audio.currentTime = clampTime(audio, audio.currentTime + 15);
      syncUi();
    });

    speed.addEventListener("click", () => {
      speedIndex = (speedIndex + 1) % speeds.length;
      const nextRate = speeds[speedIndex];
      audio.playbackRate = nextRate;
      speed.textContent = `${nextRate}x`;
    });

    range.addEventListener("input", () => {
      const duration = Number.isFinite(audio.duration) ? audio.duration : 0;
      if (!duration) return;
      audio.currentTime = (Number(range.value) / 100) * duration;
      syncUi();
    });

    ["loadedmetadata", "timeupdate", "play", "pause", "ended", "ratechange"].forEach((eventName) => {
      audio.addEventListener(eventName, syncUi);
    });

    syncUi();
  }

  function boot() {
    document.querySelectorAll("[data-oral-history-audio]").forEach(enhancePlayer);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})();

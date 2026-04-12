(function () {
  const COMMENTS_ENDPOINT = "/api/content-comments";
  const STYLE_ID = "content-comments-styles";

  function injectStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .content-comments {
        display: grid;
        gap: 1rem;
      }
      .content-comments-card {
        display: grid;
        gap: 1rem;
      }
      .content-comments-loading,
      .content-comments-empty,
      .content-comments-signin,
      .content-comments-status {
        margin: 0;
        color: #4f6057;
        line-height: 1.55;
      }
      .content-comments-signin {
        padding: 0.95rem 1rem;
        border-radius: 14px;
        border: 1px solid rgba(31, 64, 48, 0.12);
        background: rgba(244, 179, 91, 0.12);
      }
      .content-comments-signin a {
        color: #143227;
        font-weight: 700;
      }
      .content-comments-list {
        display: grid;
        gap: 0.8rem;
      }
      .content-comments-item {
        display: grid;
        gap: 0.35rem;
        padding: 0.95rem 1rem;
        border-radius: 14px;
        border: 1px solid rgba(31, 64, 48, 0.12);
        background: #f9f5ee;
      }
      .content-comments-author {
        font-weight: 700;
        color: #143227;
      }
      .content-comments-meta {
        color: #5c6d63;
        font-size: 0.9rem;
      }
      .content-comments-body {
        white-space: pre-wrap;
        color: #2f3934;
      }
      .content-comments-form {
        display: grid;
        gap: 0.75rem;
      }
      .content-comments-form label {
        display: grid;
        gap: 0.4rem;
        font-size: 0.95rem;
        font-weight: 700;
        color: #143227;
      }
      .content-comments-form textarea {
        width: 100%;
        min-height: 120px;
        resize: vertical;
        padding: 0.85rem 0.95rem;
        border-radius: 14px;
        border: 1px solid rgba(31, 64, 48, 0.18);
        background: #fff;
        color: #1e1f1c;
        font: inherit;
      }
      .content-comments-actions {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 0.75rem;
        flex-wrap: wrap;
      }
      .content-comments-submit {
        appearance: none;
        border: 0;
        border-radius: 999px;
        padding: 0.8rem 1rem;
        background: #143227;
        color: #fff;
        font: inherit;
        font-weight: 700;
        cursor: pointer;
      }
      .content-comments-submit:disabled {
        opacity: 0.6;
        cursor: wait;
      }
    `;
    document.head.appendChild(style);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDate(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleString();
  }

  function normalizePathSlug(pathname) {
    const clean = String(pathname || "").replace(/\/+$/, "");
    const segment = clean.split("/").filter(Boolean).pop() || "";
    return segment.toLowerCase();
  }

  function resolveEntitySlug(container) {
    const explicit = String(container.dataset.entitySlug || "").trim();
    if (explicit) return explicit;

    const queryParam = String(container.dataset.entitySlugQuery || "").trim();
    if (queryParam) {
      return String(new URLSearchParams(window.location.search).get(queryParam) || "").trim().toLowerCase();
    }

    return normalizePathSlug(window.location.pathname);
  }

  async function ensureAuth() {
    if (window.siteAuth?.getSession) return window.siteAuth;
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[src="/assets/auth.js"]');
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (window.siteAuth?.getSession) resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = "/assets/auth.js";
      script.addEventListener("load", resolve, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
    return window.siteAuth || null;
  }

  async function getAuthHeader() {
    try {
      const auth = await ensureAuth();
      const session = auth ? await auth.getSession() : null;
      return session?.access_token ? { Authorization: "Bearer " + session.access_token } : {};
    } catch (error) {
      return {};
    }
  }

  function renderShell(container) {
    container.innerHTML = `
      <h2>Discussion</h2>
      <div class="content-comments-card">
        <div class="content-comments-loading">Loading comments...</div>
        <div class="content-comments-list" hidden></div>
        <p class="content-comments-empty" hidden>No comments yet. Start the discussion.</p>
        <div class="content-comments-signin" hidden></div>
        <form class="content-comments-form" hidden>
          <label>
            <span>Comment</span>
            <textarea name="body" maxlength="1200" placeholder="Add your comment."></textarea>
          </label>
          <div class="content-comments-actions">
            <p class="content-comments-status" aria-live="polite"></p>
            <button class="content-comments-submit" type="submit">Send comment</button>
          </div>
        </form>
      </div>
    `;
  }

  async function initComments(container) {
    const entityType = String(container.dataset.entityType || "").trim();
    const entitySlug = resolveEntitySlug(container);
    if (!entityType || !entitySlug) return;

    renderShell(container);

    const loadingEl = container.querySelector(".content-comments-loading");
    const listEl = container.querySelector(".content-comments-list");
    const emptyEl = container.querySelector(".content-comments-empty");
    const signinEl = container.querySelector(".content-comments-signin");
    const formEl = container.querySelector(".content-comments-form");
    const bodyEl = formEl.querySelector("textarea");
    const statusEl = container.querySelector(".content-comments-status");
    const submitEl = container.querySelector(".content-comments-submit");
    const loginUrl = "/login/?next=" + encodeURIComponent(window.location.pathname + window.location.search);

    let viewer = { signedIn: false };

    function renderViewer() {
      signinEl.hidden = viewer.signedIn;
      formEl.hidden = !viewer.signedIn;
      signinEl.innerHTML = `<a href="${escapeHtml(loginUrl)}">Login or create an account</a> to add a comment.`;
    }

    function renderComments(comments) {
      listEl.innerHTML = "";
      if (!Array.isArray(comments) || !comments.length) {
        listEl.hidden = true;
        emptyEl.hidden = false;
        return;
      }

      emptyEl.hidden = true;
      listEl.hidden = false;
      listEl.innerHTML = comments.map((comment) => `
        <article class="content-comments-item">
          <div class="content-comments-author">${escapeHtml(comment.authorName || "Bly member")}</div>
          <div class="content-comments-meta">${escapeHtml(formatDate(comment.createdAt))}</div>
          <div class="content-comments-body">${escapeHtml(comment.body || "")}</div>
        </article>
      `).join("");
    }

    async function loadComments() {
      loadingEl.hidden = false;
      listEl.hidden = true;
      emptyEl.hidden = true;

      try {
        const headers = await getAuthHeader();
        const response = await fetch(
          `${COMMENTS_ENDPOINT}?entityType=${encodeURIComponent(entityType)}&entitySlug=${encodeURIComponent(entitySlug)}`,
          { cache: "no-store", headers }
        );
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to load comments.");
        viewer = payload.viewer || viewer;
        renderViewer();
        renderComments(Array.isArray(payload.comments) ? payload.comments : []);
        loadingEl.hidden = true;
      } catch (error) {
        loadingEl.hidden = true;
        emptyEl.hidden = false;
        emptyEl.textContent = error.message || "Unable to load comments.";
      }
    }

    formEl.addEventListener("submit", async (event) => {
      event.preventDefault();
      const body = bodyEl.value.trim();
      if (!body) {
        statusEl.textContent = "Write a comment before posting.";
        return;
      }

      submitEl.disabled = true;
      statusEl.textContent = "Posting comment...";
      try {
        const auth = await ensureAuth();
        const session = auth ? await auth.getSession() : null;
        if (!session) {
          window.location.replace(loginUrl);
          return;
        }

        const response = await fetch(COMMENTS_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + session.access_token,
          },
          body: JSON.stringify({
            entityType,
            entitySlug,
            body,
          }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || "Unable to publish comment.");

        bodyEl.value = "";
        statusEl.textContent = "Comment posted.";
        await loadComments();
      } catch (error) {
        statusEl.textContent = error.message || "Unable to publish comment.";
      } finally {
        submitEl.disabled = false;
      }
    });

    await loadComments();
  }

  injectStyles();
  document.querySelectorAll(".content-comments[data-entity-type]").forEach((container) => {
    initComments(container);
  });
})();

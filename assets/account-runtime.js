(function () {
  const CACHE_PREFIX = "bly:account:";
  const PREFETCHED_HREFS = new Set();
  let sessionPromise = null;

  function getStorage() {
    try {
      return window.sessionStorage;
    } catch (_error) {
      return null;
    }
  }

  function cacheKey(key) {
    return `${CACHE_PREFIX}${key}`;
  }

  function readCache(key) {
    const storage = getStorage();
    if (!storage) return null;
    try {
      const raw = storage.getItem(cacheKey(key));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== "object") return null;
      return parsed;
    } catch (_error) {
      return null;
    }
  }

  function writeCache(key, data) {
    const storage = getStorage();
    if (!storage) return data;
    try {
      storage.setItem(cacheKey(key), JSON.stringify({
        cachedAt: Date.now(),
        data,
      }));
    } catch (_error) {
      // Ignore storage write failures.
    }
    return data;
  }

  function getCachedJson(key, options = {}) {
    const entry = readCache(key);
    if (!entry) return null;
    const maxAgeMs = Number(options.maxAgeMs || 0);
    if (maxAgeMs > 0 && Date.now() - Number(entry.cachedAt || 0) > maxAgeMs) {
      return null;
    }
    return entry.data ?? null;
  }

  function clearAccountCache() {
    const storage = getStorage();
    if (!storage) return;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && key.startsWith(CACHE_PREFIX)) keys.push(key);
    }
    keys.forEach((key) => storage.removeItem(key));
  }

  async function getSession() {
    if (!sessionPromise) {
      sessionPromise = window.siteAuth.getSession().catch((error) => {
        sessionPromise = null;
        throw error;
      });
    }
    return sessionPromise;
  }

  async function requireSession(loginUrl) {
    const session = await getSession();
    if (!session) {
      window.location.replace(loginUrl);
      return null;
    }
    return session;
  }

  async function fetchJson(url, options = {}) {
    const requestHeaders = new Headers(options.headers || {});
    if (options.token) {
      requestHeaders.set("Authorization", `Bearer ${options.token}`);
    }
    if (options.body && !(options.body instanceof FormData) && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }

    const response = await fetch(url, {
      method: options.method || "GET",
      headers: requestHeaders,
      body: options.body,
      cache: "no-store",
    });
    const payload = await response.json().catch(() => ({}));
    if (response.ok && (options.method || "GET").toUpperCase() === "GET" && options.cacheKey) {
      writeCache(options.cacheKey, payload);
    }
    return { response, payload };
  }

  function prefetchDocument(href) {
    if (!href || PREFETCHED_HREFS.has(href)) return;
    PREFETCHED_HREFS.add(href);
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "document";
    link.href = href;
    document.head.appendChild(link);
  }

  function warmAccountLinks(root = document) {
    const links = Array.from(root.querySelectorAll('a[href^="/account/"]'));
    links.forEach((link) => {
      const href = link.getAttribute("href");
      if (!href) return;
      const warm = () => prefetchDocument(href);
      link.addEventListener("pointerenter", warm, { once: true });
      link.addEventListener("focus", warm, { once: true });
    });

    const queueWarm = () => {
      links.forEach((link) => prefetchDocument(link.getAttribute("href")));
    };

    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(queueWarm, { timeout: 1500 });
    } else {
      window.setTimeout(queueWarm, 700);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => warmAccountLinks(), { once: true });
  } else {
    warmAccountLinks();
  }

  window.accountRuntime = {
    clearAccountCache,
    fetchJson,
    getCachedJson,
    getSession,
    rememberJson: writeCache,
    requireSession,
    warmAccountLinks,
  };
})();

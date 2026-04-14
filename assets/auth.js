(function () {
  let supabaseClientPromise = null;
  let configPromise = null;
  const AUTH_CONFIG_CACHE_KEY = "bly:auth-config";
  const FAVICON_HREF = "/assets/favicon-32.png";
  const APPLE_TOUCH_ICON_HREF = "/assets/apple-touch-icon.png";

  function ensureFavicon() {
    if (typeof document === "undefined") return;

    const ensureLink = (selector, rel) => {
      let link = document.querySelector(selector);
      if (!link) {
        link = document.createElement("link");
        link.rel = rel;
        document.head.appendChild(link);
      }
      link.href = rel === "apple-touch-icon" ? APPLE_TOUCH_ICON_HREF : FAVICON_HREF;
      if (rel === "icon") {
        link.type = "image/png";
        link.sizes = "32x32";
      }
      return link;
    };

    ensureLink('link[rel="icon"]', "icon");
    ensureLink('link[rel="apple-touch-icon"]', "apple-touch-icon");
  }

  ensureFavicon();

  function getStorage() {
    try {
      return window.sessionStorage;
    } catch (_error) {
      return null;
    }
  }

  async function loadScript(src) {
    await new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
        if (existing.dataset.loaded === "true") resolve();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.defer = true;
      script.addEventListener("load", () => {
        script.dataset.loaded = "true";
        resolve();
      }, { once: true });
      script.addEventListener("error", reject, { once: true });
      document.head.appendChild(script);
    });
  }

  async function getConfig() {
    if (!configPromise) {
      const storage = getStorage();
      const cached = storage ? storage.getItem(AUTH_CONFIG_CACHE_KEY) : null;
      if (cached) {
        try {
          configPromise = Promise.resolve(JSON.parse(cached));
        } catch (_error) {
          if (storage) storage.removeItem(AUTH_CONFIG_CACHE_KEY);
        }
      }
      if (!configPromise) {
        configPromise = fetch("/api/auth-config")
          .then(async (response) => {
            const data = await response.json().catch(() => ({}));
            if (!response.ok) throw new Error(data.error || "Unable to load auth config.");
            if (storage) {
              try {
                storage.setItem(AUTH_CONFIG_CACHE_KEY, JSON.stringify(data));
              } catch (_error) {
                // Ignore storage write failures.
              }
            }
            return data;
          });
      }
    }
    return configPromise;
  }

  async function getClient() {
    if (!supabaseClientPromise) {
      supabaseClientPromise = (async () => {
        await loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2");
        const config = await getConfig();
        return window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
          auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
          },
        });
      })();
    }
    return supabaseClientPromise;
  }

  async function login(email, password) {
    const client = await getClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    return data;
  }

  async function signUp(email, password, metadata = {}) {
    const client = await getClient();
    const config = await getConfig();
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
        emailRedirectTo: `${config.siteUrl}/login/`,
      },
    });
    if (error) throw error;
    return data;
  }

  async function signInWithProvider(provider, redirectPath = "/account/") {
    const client = await getClient();
    const config = await getConfig();
    const normalizedPath = String(redirectPath || "/account/").startsWith("/")
      ? String(redirectPath || "/account/")
      : `/${String(redirectPath || "account/")}`;
    const redirectTo = `${config.siteUrl}/login/?next=${encodeURIComponent(normalizedPath)}`;
    const { data, error } = await client.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
      },
    });
    if (error) throw error;
    return data;
  }

  async function logout() {
    const client = await getClient();
    const { error } = await client.auth.signOut();
    if (error) throw error;
  }

  async function getSession() {
    const client = await getClient();
    const { data, error } = await client.auth.getSession();
    if (error) throw error;
    return data.session || null;
  }

  async function getAccessToken() {
    const session = await getSession();
    return session?.access_token || null;
  }

  async function onAuthStateChange(callback) {
    const client = await getClient();
    return client.auth.onAuthStateChange(callback);
  }

  window.siteAuth = {
    getAccessToken,
    getClient,
    getConfig,
    getSession,
    login,
    logout,
    onAuthStateChange,
    signInWithProvider,
    signUp,
  };
})();

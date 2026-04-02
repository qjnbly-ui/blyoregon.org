(function () {
  let supabaseClientPromise = null;
  let configPromise = null;

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
      configPromise = fetch("/api/auth-config")
        .then(async (response) => {
          const data = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(data.error || "Unable to load auth config.");
          return data;
        });
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
    const { data, error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: metadata,
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
    signUp,
  };
})();

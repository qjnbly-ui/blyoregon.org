(function () {
  const STYLE_ID = "shared-homepage-nav-styles";
  const MARKER_ID = "shared-homepage-nav";
  const LINKS = [
    { href: "/", label: "Home" },
    { href: "/about/", label: "About" },
    { href: "/community/", label: "Community" },
    { href: "/businesses/", label: "Businesses" },
    { href: "/history/", label: "History" },
    { href: "/recreation/", label: "Recreation" },
  ];

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[src="${src}"]`);
      if (existing) {
        if (existing.dataset.loaded === "true") {
          resolve();
          return;
        }
        existing.addEventListener("load", resolve, { once: true });
        existing.addEventListener("error", reject, { once: true });
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

  async function ensureAuth() {
    if (window.siteAuth?.getSession) return window.siteAuth;
    await loadScript("/assets/auth.js").catch(() => null);
    return window.siteAuth || null;
  }

  function hasExistingPrimaryNav() {
    if (document.getElementById(MARKER_ID)) return true;
    const navLinks = Array.from(document.querySelectorAll(".nav-links a[href], nav a[href]"));
    const hrefs = new Set(navLinks.map((link) => link.getAttribute("href")));
    return LINKS.every((link) => hrefs.has(link.href));
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      :root {
        --mobile-header-height: 6.2rem;
      }

      body.has-shared-homepage-nav {
        margin: 0;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} {
        z-index: 30;
        background: rgba(20, 50, 39, 0.96);
        color: #fff;
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .header-inner {
        max-width: 1100px;
        margin: 0 auto;
        padding: 0.9rem 1.5rem;
        display: flex;
        flex-direction: row;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        flex-wrap: wrap;
        text-align: initial;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .brand {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        text-align: center;
        text-decoration: none;
        color: #fff;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .brand-title {
        font-family: "Fraunces", "Times New Roman", serif;
        font-weight: 700;
        font-size: 1.4rem;
        letter-spacing: 0.02em;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .brand-subtitle {
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.7);
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} nav {
        display: flex;
        flex-direction: row;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
        width: auto;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .nav-links {
        display: flex;
        flex-direction: row;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} nav a {
        color: #fff;
        text-decoration: none;
        font-family: "Manrope", "Trebuchet MS", sans-serif;
        font-weight: 600;
        font-size: 0.95rem;
        padding: 0.4rem 0.75rem;
        border-radius: 999px;
        border: 1px solid transparent;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} nav a.account-link {
        border-color: rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.12);
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} nav a:hover {
        border-color: rgba(255, 255, 255, 0.5);
        background: rgba(255, 255, 255, 0.08);
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-nav {
        display: none;
        align-items: center;
        gap: 1.1rem;
        margin-left: auto;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-login {
        color: #fff;
        text-decoration: none;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        font-size: 0.9rem;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-menu-toggle {
        list-style: none;
        display: inline-flex;
        align-items: center;
        gap: 0.9rem;
        cursor: pointer;
        color: #fff;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        font-size: 0.9rem;
        padding: 0.9rem 1.2rem;
        border-radius: 999px;
        border: 1px solid rgba(255, 255, 255, 0.28);
        background: rgba(7, 10, 16, 0.38);
        appearance: none;
      }

      body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-menu-toggle::before {
        content: "";
        width: 1.4rem;
        height: 2px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 -0.42rem 0 currentColor, 0 0.42rem 0 currentColor;
      }

      body.has-shared-homepage-nav > .mobile-menu-panel {
        display: none;
        position: fixed;
        inset: 0 0 0;
        min-width: 0;
        padding: 0 1.5rem 2rem;
        border-radius: 0;
        border: 0;
        background: linear-gradient(180deg, rgba(247, 242, 234, 0.99), rgba(243, 239, 233, 0.99));
        box-shadow: none;
        align-content: start;
        z-index: 31;
        overflow-y: auto;
      }

      body.has-shared-homepage-nav > .mobile-menu-panel[hidden] {
        display: none !important;
      }

      body.has-shared-homepage-nav.mobile-menu-open > .mobile-menu-panel {
        display: grid;
        gap: 0;
      }

      body.has-shared-homepage-nav.mobile-menu-open {
        overflow: hidden;
      }

      body.has-shared-homepage-nav > .mobile-menu-panel a {
        display: block;
        padding: 1.7rem 0;
        border-radius: 0;
        border: 0;
        border-bottom: 1px solid rgba(20, 50, 39, 0.18);
        background: none;
        color: #143227;
        text-decoration: none;
        text-align: center;
        text-transform: none;
        letter-spacing: 0.02em;
        font-family: "Manrope", "Trebuchet MS", sans-serif;
        font-weight: 600;
        font-size: 0.95rem;
      }

      @media (max-width: 800px) {
        body.has-shared-homepage-nav > header#${MARKER_ID} .header-inner {
          justify-content: center;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} nav {
          justify-content: center;
        }
      }

      @media (max-width: 760px) {
        body.has-shared-homepage-nav {
          padding-top: var(--mobile-header-height);
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          z-index: 30;
          border-bottom: 0;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .header-inner {
          justify-content: space-between;
          flex-wrap: nowrap;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .brand {
          flex: 1 1 auto;
          text-align: center;
          align-items: center;
          position: relative;
          z-index: 32;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} nav {
          width: auto;
          justify-content: flex-end;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .brand-title,
        body.has-shared-homepage-nav > header#${MARKER_ID} .brand-subtitle,
        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-login {
          color: #fff;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .nav-links,
        body.has-shared-homepage-nav > header#${MARKER_ID} nav a.account-link {
          display: none;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-nav {
          display: flex;
          gap: 0.8rem;
          position: relative;
          z-index: 32;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-login {
          font-size: 0.82rem;
          letter-spacing: 0.16em;
          text-transform: uppercase;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-menu-toggle {
          width: 4rem;
          height: 4rem;
          justify-content: center;
          gap: 0;
          padding: 0;
          border-radius: 999px;
          font-size: 0;
          color: #fff;
          background: rgba(7, 10, 16, 0.38);
          position: relative;
          z-index: 32;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-nav.is-open .mobile-menu-toggle {
          color: #143227;
          background: rgba(245, 239, 229, 0.96);
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-menu-toggle::before {
          width: 1.15rem;
          box-shadow: 0 -0.35rem 0 currentColor, 0 0.35rem 0 currentColor;
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-nav.is-open .mobile-menu-toggle::before {
          content: "";
          position: absolute;
          width: 1.45rem;
          height: 0;
          background: none;
          box-shadow: none;
          border-radius: 0;
          border-top: 3px solid currentColor;
          transform: rotate(45deg);
        }

        body.has-shared-homepage-nav > header#${MARKER_ID} .mobile-nav.is-open .mobile-menu-toggle::after {
          content: "";
          position: absolute;
          width: 1.45rem;
          height: 0;
          background: none;
          border-radius: 0;
          border-top: 3px solid currentColor;
          transform: rotate(-45deg);
        }

        body.has-shared-homepage-nav > .mobile-menu-panel {
          top: var(--mobile-header-height);
          background: linear-gradient(180deg, #f7f2ea 0%, #f3efe9 100%);
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildHeader() {
    const header = document.createElement("header");
    header.id = MARKER_ID;
    header.innerHTML = `
      <div class="header-inner">
        <a class="brand" href="/">
          <div class="brand-title">Bly, Oregon</div>
          <div class="brand-subtitle">A Community in Klamath County</div>
        </a>
        <nav>
          <div class="nav-links">
            ${LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`).join("")}
          </div>
          <a class="account-link" href="/account/">Account</a>
          <div class="mobile-nav">
            <a class="mobile-login" href="/login/">Login</a>
            <button class="mobile-menu-toggle" type="button" aria-expanded="false" aria-label="Toggle menu"></button>
          </div>
        </nav>
      </div>
    `;

    const panel = document.createElement("div");
    panel.className = "mobile-menu-panel";
    panel.hidden = true;
    panel.innerHTML = LINKS.map((link) => `<a href="${link.href}">${link.label}</a>`).join("");

    return { header, panel };
  }

  function mountBehavior(header, panel) {
    const mobileNav = header.querySelector(".mobile-nav");
    const toggle = header.querySelector(".mobile-menu-toggle");
    const authLinks = header.querySelectorAll("a.account-link, a.mobile-login");
    if (!mobileNav || !toggle || !panel) return;

    const syncMobileHeaderHeight = () => {
      document.documentElement.style.setProperty("--mobile-header-height", `${header.offsetHeight}px`);
    };

    const syncAuthNav = async () => {
      const auth = await ensureAuth();
      const session = await auth?.getSession?.().catch(() => null);
      authLinks.forEach((link) => {
        link.textContent = session ? "Account" : "Login";
        link.href = session ? "/account/" : "/login/";
      });
    };

    const closeMenu = () => {
      mobileNav.classList.remove("is-open");
      document.body.classList.remove("mobile-menu-open");
      toggle.setAttribute("aria-expanded", "false");
      panel.setAttribute("hidden", "");
    };

    syncMobileHeaderHeight();
    window.addEventListener("resize", syncMobileHeaderHeight);
    syncAuthNav().catch(() => null);
    ensureAuth().then((auth) => {
      auth?.onAuthStateChange?.(() => {
        syncAuthNav().catch(() => null);
      });
    }).catch(() => null);

    toggle.addEventListener("click", () => {
      syncMobileHeaderHeight();
      const isOpen = mobileNav.classList.toggle("is-open");
      document.body.classList.toggle("mobile-menu-open", isOpen);
      toggle.setAttribute("aria-expanded", String(isOpen));
      if (isOpen) {
        panel.removeAttribute("hidden");
      } else {
        panel.setAttribute("hidden", "");
      }
    });

    panel.querySelectorAll("a").forEach((link) => {
      link.addEventListener("click", closeMenu);
    });

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") closeMenu();
    });
  }

  function insertHeader() {
    if (hasExistingPrimaryNav()) return;
    const body = document.body;
    if (!body) return;
    const { header, panel } = buildHeader();
    body.classList.add("has-shared-homepage-nav");
    body.insertBefore(panel, body.firstChild);
    body.insertBefore(header, panel);
    mountBehavior(header, panel);
  }

  ensureStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", insertHeader, { once: true });
  } else {
    insertHeader();
  }
})();

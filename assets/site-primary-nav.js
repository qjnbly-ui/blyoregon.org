(function () {
  const STYLE_ID = "site-primary-nav-styles";
  const HEADER_CLASS = "site-primary-nav-header";
  const BODY_OPEN_CLASS = "site-primary-nav-open";
  const LINKS = [
    { href: "/", label: "Home" },
    { href: "/about/", label: "About" },
    { href: "/community/", label: "Community" },
    { href: "/businesses/", label: "Businesses" },
    { href: "/history/", label: "History" },
    { href: "/recreation/", label: "Recreation" },
  ];

  function hasExistingPrimaryNav() {
    if (document.querySelector(`.${HEADER_CLASS}`)) return true;
    const navLinks = Array.from(document.querySelectorAll(".nav-links a[href], nav a[href]"));
    const hrefs = new Set(navLinks.map((link) => link.getAttribute("href")));
    return LINKS.every((link) => hrefs.has(link.href));
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = `
      .${HEADER_CLASS} {
        position: relative;
        z-index: 40;
        background: rgba(20, 50, 39, 0.96);
        color: #fff;
        backdrop-filter: blur(8px);
        border-bottom: 1px solid rgba(255, 255, 255, 0.1);
      }

      .${HEADER_CLASS} .site-primary-nav-inner {
        max-width: 1100px;
        margin: 0 auto;
        padding: 0.9rem 1.5rem;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 1.5rem;
        flex-wrap: wrap;
      }

      .${HEADER_CLASS} .site-primary-brand {
        display: flex;
        flex-direction: column;
        gap: 0.1rem;
        text-align: center;
        text-decoration: none;
        color: #fff;
      }

      .${HEADER_CLASS} .site-primary-brand-title {
        font-family: "Fraunces", "Times New Roman", serif;
        font-weight: 700;
        font-size: 1.4rem;
        letter-spacing: 0.02em;
      }

      .${HEADER_CLASS} .site-primary-brand-subtitle {
        font-family: "Manrope", "Trebuchet MS", sans-serif;
        font-size: 0.85rem;
        color: rgba(255, 255, 255, 0.7);
      }

      .${HEADER_CLASS} .site-primary-nav {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: flex-end;
        align-items: center;
      }

      .${HEADER_CLASS} .site-primary-links {
        display: flex;
        gap: 0.75rem;
        flex-wrap: wrap;
        justify-content: flex-end;
      }

      .${HEADER_CLASS} .site-primary-nav a,
      .${HEADER_CLASS} .site-primary-mobile-login {
        color: #fff;
        text-decoration: none;
        font-family: "Manrope", "Trebuchet MS", sans-serif;
        font-weight: 600;
        font-size: 0.95rem;
        padding: 0.4rem 0.75rem;
        border-radius: 999px;
        border: 1px solid transparent;
      }

      .${HEADER_CLASS} .site-primary-login {
        border-color: rgba(255, 255, 255, 0.35);
        background: rgba(255, 255, 255, 0.12);
      }

      .${HEADER_CLASS} .site-primary-nav a:hover,
      .${HEADER_CLASS} .site-primary-mobile-login:hover {
        border-color: rgba(255, 255, 255, 0.5);
        background: rgba(255, 255, 255, 0.08);
      }

      .${HEADER_CLASS} .site-primary-mobile-nav {
        display: none;
        align-items: center;
        gap: 1.1rem;
        margin-left: auto;
      }

      .${HEADER_CLASS} .site-primary-mobile-login {
        text-transform: uppercase;
        letter-spacing: 0.2em;
        font-size: 0.9rem;
      }

      .${HEADER_CLASS} .site-primary-menu-toggle {
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

      .${HEADER_CLASS} .site-primary-menu-toggle::before {
        content: "";
        width: 1.4rem;
        height: 2px;
        border-radius: 999px;
        background: currentColor;
        box-shadow: 0 -0.42rem 0 currentColor, 0 0.42rem 0 currentColor;
      }

      .site-primary-mobile-panel {
        display: none;
        position: fixed;
        inset: 0;
        min-width: 0;
        padding: 0 1.5rem 2rem;
        border: 0;
        background: linear-gradient(180deg, rgba(247, 242, 234, 0.99), rgba(243, 239, 233, 0.99));
        z-index: 41;
        overflow-y: auto;
      }

      .site-primary-mobile-panel[hidden] {
        display: none !important;
      }

      body.${BODY_OPEN_CLASS} .site-primary-mobile-panel {
        display: grid;
        gap: 0;
      }

      body.${BODY_OPEN_CLASS} {
        overflow: hidden;
      }

      .site-primary-mobile-panel a {
        display: block;
        padding: 1.7rem 0;
        border: 0;
        border-bottom: 1px solid rgba(20, 50, 39, 0.18);
        background: none;
        color: #143227;
        text-decoration: none;
        text-align: center;
        font-family: "Manrope", "Trebuchet MS", sans-serif;
        font-weight: 600;
        font-size: 0.95rem;
      }

      @media (max-width: 760px) {
        .${HEADER_CLASS} .site-primary-links,
        .${HEADER_CLASS} .site-primary-login {
          display: none;
        }

        .${HEADER_CLASS} .site-primary-mobile-nav {
          display: flex;
          gap: 0.5rem;
        }

        .${HEADER_CLASS} .site-primary-nav {
          width: auto;
        }

        .${HEADER_CLASS} .site-primary-nav-inner {
          justify-content: space-between;
          flex-wrap: nowrap;
        }

        .${HEADER_CLASS} .site-primary-brand {
          flex: 1 1 auto;
          align-items: center;
        }

        .${HEADER_CLASS} .site-primary-menu-toggle {
          width: 4rem;
          height: 4rem;
          justify-content: center;
          gap: 0;
          padding: 0;
          font-size: 0;
        }
      }
    `;
    document.head.appendChild(style);
  }

  function buildHeader() {
    const header = document.createElement("div");
    header.className = HEADER_CLASS;

    const inner = document.createElement("div");
    inner.className = "site-primary-nav-inner";

    const brand = document.createElement("a");
    brand.className = "site-primary-brand";
    brand.href = "/";
    brand.innerHTML = '<span class="site-primary-brand-title">Bly, Oregon</span><span class="site-primary-brand-subtitle">A Community in Klamath County</span>';

    const nav = document.createElement("nav");
    nav.className = "site-primary-nav";
    nav.setAttribute("aria-label", "Primary");

    const links = document.createElement("div");
    links.className = "site-primary-links";
    LINKS.forEach((link) => {
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      links.appendChild(anchor);
    });

    const login = document.createElement("a");
    login.className = "site-primary-login";
    login.href = "/login/";
    login.textContent = "Login";

    const mobileNav = document.createElement("div");
    mobileNav.className = "site-primary-mobile-nav";

    const mobileLogin = document.createElement("a");
    mobileLogin.className = "site-primary-mobile-login";
    mobileLogin.href = "/login/";
    mobileLogin.textContent = "Login";

    const toggle = document.createElement("button");
    toggle.className = "site-primary-menu-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.setAttribute("aria-label", "Toggle menu");

    mobileNav.append(mobileLogin, toggle);
    nav.append(links, login, mobileNav);
    inner.append(brand, nav);
    header.appendChild(inner);

    const panel = document.createElement("div");
    panel.className = "site-primary-mobile-panel";
    panel.hidden = true;
    [...LINKS, { href: "/login/", label: "Login" }].forEach((link) => {
      const anchor = document.createElement("a");
      anchor.href = link.href;
      anchor.textContent = link.label;
      panel.appendChild(anchor);
    });

    function closeMenu() {
      document.body.classList.remove(BODY_OPEN_CLASS);
      toggle.setAttribute("aria-expanded", "false");
      panel.hidden = true;
    }

    toggle.addEventListener("click", () => {
      const opening = panel.hidden;
      document.body.classList.toggle(BODY_OPEN_CLASS, opening);
      toggle.setAttribute("aria-expanded", String(opening));
      panel.hidden = !opening;
    });

    panel.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

    return { header, panel };
  }

  function insertHeader() {
    if (hasExistingPrimaryNav()) return;
    const body = document.body;
    if (!body) return;
    const { header, panel } = buildHeader();
    body.insertBefore(panel, body.firstChild);
    body.insertBefore(header, panel);
  }

  ensureStyles();
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", insertHeader, { once: true });
  } else {
    insertHeader();
  }
})();

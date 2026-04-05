(function () {
  function createMessageLink(memberId) {
    const normalizedId = String(memberId || "").trim();
    if (!normalizedId) return "";
    return `/account/messages/?with=${encodeURIComponent(normalizedId)}`;
  }

  function createLoginLink(memberId) {
    const messageUrl = createMessageLink(memberId);
    return messageUrl ? `/login/?next=${encodeURIComponent(messageUrl)}` : "/login/";
  }

  function configureMessageAction(element, options = {}) {
    if (!element) return;

    const memberId = String(options.memberId || "").trim();
    const canMessage = options.canMessage !== false && Boolean(memberId);
    const signedIn = Boolean(options.signedIn);
    const messageLabel = String(options.messageLabel || "Message member");
    const loginLabel = String(options.loginLabel || "Sign in to message");

    if (!canMessage) {
      element.hidden = true;
      element.removeAttribute("href");
      element.removeAttribute("data-message-target");
      if ("disabled" in element) element.disabled = true;
      return;
    }

    const targetUrl = signedIn ? createMessageLink(memberId) : createLoginLink(memberId);
    const label = signedIn ? messageLabel : loginLabel;

    element.hidden = false;
    if ("disabled" in element) element.disabled = false;
    element.setAttribute("data-message-target", targetUrl);

    if (element.tagName === "A") {
      element.href = targetUrl;
    } else {
      element.onclick = () => {
        window.location.href = targetUrl;
      };
    }

    if ("textContent" in element && label) {
      element.textContent = label;
    }
  }

  window.memberContact = {
    configureMessageAction,
    createLoginLink,
    createMessageLink,
  };
})();

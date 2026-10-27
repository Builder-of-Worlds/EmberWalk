/* global document, window, fetch */
export const MESSAGES = {
  success: "You're on the list. We'll email you when EmberWalk launches.",
  invalid_email: "That email address doesn't look right. Please check it and try again.",
  invalid_role: "Please choose the one that describes you best.",
  no_token: "Please wait a moment for the check to finish, then try again.",
  turnstile_failed: "We couldn't confirm you're a person. Please try again.",
  server: "Something went wrong on our end. Please try again, or write to hello@emberwalk.app.",
  network: "We couldn't reach the server. Please check your connection and try again.",
};

export function revealOnScroll(doc, win) {
  const items = [...doc.querySelectorAll(".focus-in")];
  items.forEach((item, index) => item.style.setProperty("--i", String(index % 2)));
  if (!("IntersectionObserver" in win)) {
    items.forEach((item) => item.classList.add("in"));
    return;
  }
  const watcher = new win.IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("in");
        watcher.unobserve(entry.target);
      }
    },
    { threshold: 0.15, rootMargin: "0px 0px -6% 0px" },
  );
  items.forEach((item) => watcher.observe(item));
}

export function startTurnstile(doc, win, fetchImpl, box, onToken) {
  const widget = { id: null };
  const render = () => {
    widget.id = win.turnstile.render(box, {
      sitekey: widget.siteKey,
      appearance: "interaction-only",
      callback: onToken,
      "expired-callback": () => onToken(""),
      "error-callback": () => onToken(""),
    });
  };
  fetchImpl("/api/config")
    .then((response) => response.json())
    .then((config) => {
      widget.siteKey = config.turnstileSiteKey;
      const script = doc.createElement("script");
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.onload = render;
      doc.head.append(script);
    })
    .catch(() => onToken(""));
  return () => {
    if (widget.id !== null && win.turnstile) win.turnstile.reset(widget.id);
    onToken("");
  };
}

export function setupSignup(doc, win, fetchImpl) {
  const form = doc.getElementById("signup");
  if (!form) return;
  const status = doc.getElementById("signup-status");
  const button = form.querySelector("button");
  let token = "";
  const resetTurnstile = startTurnstile(doc, win, fetchImpl, doc.getElementById("turnstile-box"), (value) => {
    token = value;
  });

  const show = (key, kind) => {
    status.textContent = MESSAGES[key];
    status.dataset.kind = kind;
    status.hidden = false;
  };

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const email = form.elements.email;
    const role = form.elements.role;
    if (!email.validity.valid || email.value.trim() === "") return show("invalid_email", "error");
    if (role.value === "") return show("invalid_role", "error");
    if (token === "") return show("no_token", "error");

    button.disabled = true;
    try {
      const response = await fetchImpl("/api/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.value, role: role.value, turnstileToken: token }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) {
        for (const field of form.querySelectorAll(".control, .button, .turnstile-box")) field.hidden = true;
        return show("success", "ok");
      }
      resetTurnstile();
      show(MESSAGES[result.error] ? result.error : "server", "error");
    } catch {
      resetTurnstile();
      show("network", "error");
    } finally {
      button.disabled = false;
    }
  });
}

export function start(doc, win, fetchImpl) {
  revealOnScroll(doc, win);
  setupSignup(doc, win, fetchImpl);
}

if (typeof document !== "undefined") start(document, window, (...args) => fetch(...args));

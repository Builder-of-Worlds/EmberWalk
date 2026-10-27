import { describe, expect, it } from "vitest";
// @ts-expect-error the page script is plain JavaScript
import { MESSAGES, revealOnScroll, setupSignup, start, startTurnstile } from "../public/site.js";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function item() {
  const classes = new Set<string>();
  const vars = new Map<string, string>();
  return { classes, vars, classList: { add: (name: string) => classes.add(name) }, style: { setProperty: (key: string, value: string) => vars.set(key, value) } };
}

function observerWindow() {
  const seen: { options: unknown; observed: unknown[]; unobserved: unknown[]; notify: (entries: unknown[]) => void } = {
    options: null,
    observed: [],
    unobserved: [],
    notify: () => {},
  };
  class FakeObserver {
    constructor(callback: (entries: unknown[]) => void, options: unknown) {
      seen.options = options;
      seen.notify = callback;
    }
    observe(target: unknown) {
      seen.observed.push(target);
    }
    unobserve(target: unknown) {
      seen.unobserved.push(target);
    }
  }
  return { seen, win: { IntersectionObserver: FakeObserver } as Record<string, unknown> };
}

describe("revealOnScroll", () => {
  it("alternates a delay step across the items", () => {
    const items = [item(), item(), item()];
    revealOnScroll({ querySelectorAll: () => items }, {});
    expect(items.map((entry) => entry.vars.get("--i"))).toEqual(["0", "1", "0"]);
  });

  it("shows every item at once when the browser cannot watch scrolling", () => {
    const items = [item(), item()];
    revealOnScroll({ querySelectorAll: () => items }, {});
    expect(items.map((entry) => [...entry.classes])).toEqual([["in"], ["in"]]);
  });

  it("watches every item and reveals each one only when it comes into view, once", () => {
    const items = [item(), item()];
    const { seen, win } = observerWindow();
    revealOnScroll({ querySelectorAll: () => items }, win);
    expect(seen.options).toEqual({ threshold: 0.15, rootMargin: "0px 0px -6% 0px" });
    expect(seen.observed).toEqual(items);
    expect(items.every((entry) => entry.classes.size === 0)).toBe(true);

    seen.notify([{ isIntersecting: false, target: items[0] }, { isIntersecting: true, target: items[1] }]);
    expect([...items[0].classes]).toEqual([]);
    expect([...items[1].classes]).toEqual(["in"]);
    expect(seen.unobserved).toEqual([items[1]]);
  });

  it("looks for the focus-in items", () => {
    const asked: string[] = [];
    revealOnScroll({ querySelectorAll: (selector: string) => (asked.push(selector), []) }, {});
    expect(asked).toEqual([".focus-in"]);
  });
});

function turnstileRig(config: () => Promise<Response> = async () => Response.json({ turnstileSiteKey: "SITE-KEY" })) {
  const tokens: string[] = [];
  const rendered: { box: unknown; options: Record<string, unknown> }[] = [];
  const resets: unknown[] = [];
  const appended: Record<string, unknown>[] = [];
  const asked: string[] = [];
  const win = {
    turnstile: {
      render: (box: unknown, options: Record<string, unknown>) => (rendered.push({ box, options }), "widget-7"),
      reset: (id: unknown) => resets.push(id),
    },
  };
  const doc = { createElement: () => ({}) as Record<string, unknown>, head: { append: (script: Record<string, unknown>) => appended.push(script) } };
  const fetchImpl = (url: string) => (asked.push(url), config());
  return { tokens, rendered, resets, appended, asked, win, doc, fetchImpl, onToken: (value: string) => tokens.push(value) };
}

describe("startTurnstile", () => {
  it("fetches the site key, loads the Cloudflare script once and renders the quiet widget into the box", async () => {
    const rig = turnstileRig();
    const box = { id: "box" };
    startTurnstile(rig.doc, rig.win, rig.fetchImpl, box, rig.onToken);
    await flush();
    expect(rig.asked).toEqual(["/api/config"]);
    expect(rig.appended).toHaveLength(1);
    expect(rig.appended[0].src).toBe("https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit");
    expect(rig.appended[0].async).toBe(true);
    expect(rig.rendered).toHaveLength(0);

    (rig.appended[0].onload as () => void)();
    expect(rig.rendered).toHaveLength(1);
    expect(rig.rendered[0].box).toBe(box);
    expect(rig.rendered[0].options).toMatchObject({ sitekey: "SITE-KEY", appearance: "interaction-only" });
  });

  it("hands over a token when the check passes and clears it when the check expires or fails", async () => {
    const rig = turnstileRig();
    startTurnstile(rig.doc, rig.win, rig.fetchImpl, {}, rig.onToken);
    await flush();
    (rig.appended[0].onload as () => void)();
    const options = rig.rendered[0].options as Record<string, (value?: string) => void>;
    options.callback("good-token");
    options["expired-callback"]();
    options["error-callback"]();
    expect(rig.tokens).toEqual(["good-token", "", ""]);
  });

  it("resets the widget it drew, and clears the token, when asked", async () => {
    const rig = turnstileRig();
    const reset = startTurnstile(rig.doc, rig.win, rig.fetchImpl, {}, rig.onToken);
    await flush();
    (rig.appended[0].onload as () => void)();
    reset();
    expect(rig.resets).toEqual(["widget-7"]);
    expect(rig.tokens).toEqual([""]);
  });

  it("only clears the token when asked to reset before any widget was drawn", () => {
    const rig = turnstileRig();
    const reset = startTurnstile(rig.doc, rig.win, rig.fetchImpl, {}, rig.onToken);
    reset();
    expect(rig.resets).toEqual([]);
    expect(rig.tokens).toEqual([""]);
  });

  it("leaves the token empty and loads nothing when the site key cannot be fetched", async () => {
    const rig = turnstileRig(async () => {
      throw new TypeError("offline");
    });
    startTurnstile(rig.doc, rig.win, rig.fetchImpl, {}, rig.onToken);
    await flush();
    expect(rig.tokens).toEqual([""]);
    expect(rig.appended).toHaveLength(0);
  });
});

interface Rig extends ReturnType<typeof turnstileRig> {
  form: Record<string, unknown>;
  status: { textContent: string; dataset: Record<string, string>; hidden: boolean };
  button: { disabled: boolean };
  fields: { hidden: boolean }[];
  email: { value: string; validity: { valid: boolean } };
  role: { value: string };
  signups: { url: string; init: RequestInit; disabledDuring: boolean }[];
  submit: () => Promise<{ prevented: boolean }>;
}

async function signupRig(answer: () => Promise<Response> = async () => Response.json({ ok: true }), withToken = true): Promise<Rig> {
  const base = turnstileRig();
  const status = { textContent: "", dataset: {} as Record<string, string>, hidden: true };
  const button = { disabled: false };
  const fields = [{ hidden: false }, { hidden: false }, { hidden: false }];
  const email = { value: "neighbor@example.com", validity: { valid: true } };
  const role = { value: "homeowner" };
  const signups: Rig["signups"] = [];
  let handler: (event: { preventDefault: () => void }) => Promise<unknown> = async () => {};
  const form = {
    elements: { email, role },
    querySelector: () => button,
    querySelectorAll: () => fields,
    addEventListener: (type: string, fn: typeof handler) => {
      if (type === "submit") handler = fn;
    },
  };
  const elements: Record<string, unknown> = { signup: form, "signup-status": status, "turnstile-box": {} };
  const doc = { ...base.doc, getElementById: (id: string) => elements[id] ?? null };
  const fetchImpl = (url: string, init?: RequestInit) => {
    if (url === "/api/signup") {
      signups.push({ url, init: init!, disabledDuring: button.disabled });
      return answer();
    }
    return base.fetchImpl(url);
  };
  setupSignup(doc, base.win, fetchImpl);
  await flush();
  (base.appended[0].onload as () => void)();
  if (withToken) (base.rendered[0].options.callback as (value: string) => void)("good-token");
  const submit = async () => {
    let prevented = false;
    await handler({ preventDefault: () => (prevented = true) });
    return { prevented };
  };
  return { ...base, form, status, button, fields, email, role, signups, submit };
}

describe("setupSignup", () => {
  it("does nothing on a page without the form", () => {
    expect(() => setupSignup({ getElementById: () => null }, {}, () => Promise.reject(new Error("no")))).not.toThrow();
  });

  it("posts the address, the role and the token, and shows the success message with the form hidden", async () => {
    const rig = await signupRig();
    const { prevented } = await rig.submit();
    expect(prevented).toBe(true);
    expect(rig.signups).toHaveLength(1);
    expect(rig.signups[0].init.method).toBe("POST");
    expect(rig.signups[0].init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(rig.signups[0].init.body))).toEqual({ email: "neighbor@example.com", role: "homeowner", turnstileToken: "good-token" });
    expect(rig.signups[0].disabledDuring).toBe(true);
    expect(rig.button.disabled).toBe(false);
    expect(rig.fields.map((field) => field.hidden)).toEqual([true, true, true]);
    expect(rig.status).toMatchObject({ textContent: MESSAGES.success, dataset: { kind: "ok" }, hidden: false });
  });

  it.each([
    ["an email the browser rejects", (rig: Rig) => (rig.email.validity.valid = false), "invalid_email"],
    ["an empty email", (rig: Rig) => (rig.email.value = "   "), "invalid_email"],
    ["no role chosen", (rig: Rig) => (rig.role.value = ""), "invalid_role"],
  ] as const)("refuses %s without sending anything", async (_name, change, key) => {
    const rig = await signupRig();
    change(rig);
    await rig.submit();
    expect(rig.signups).toHaveLength(0);
    expect(rig.status).toMatchObject({ textContent: MESSAGES[key], dataset: { kind: "error" }, hidden: false });
    expect(rig.button.disabled).toBe(false);
    expect(rig.fields.map((field) => field.hidden)).toEqual([false, false, false]);
  });

  it("asks the person to wait when the check has not finished", async () => {
    const rig = await signupRig(undefined, false);
    await rig.submit();
    expect(rig.signups).toHaveLength(0);
    expect(rig.status.textContent).toBe(MESSAGES.no_token);
  });

  it("shows the matching message for an answer it knows, resets the check and needs a new token", async () => {
    const rig = await signupRig(async () => Response.json({ ok: false, error: "turnstile_failed" }, { status: 403 }));
    await rig.submit();
    expect(rig.status).toMatchObject({ textContent: MESSAGES.turnstile_failed, dataset: { kind: "error" }, hidden: false });
    expect(rig.resets).toEqual(["widget-7"]);
    expect(rig.fields.map((field) => field.hidden)).toEqual([false, false, false]);
    expect(rig.button.disabled).toBe(false);
    await rig.submit();
    expect(rig.signups).toHaveLength(1);
    expect(rig.status.textContent).toBe(MESSAGES.no_token);
  });

  it.each([
    ["an error it does not know", () => Response.json({ ok: false, error: "never_heard_of_it" }, { status: 500 })],
    ["an answer that is not JSON", () => new Response("<html>", { status: 502 })],
  ])("shows the server message for %s", async (_name, reply) => {
    const rig = await signupRig(async () => reply());
    await rig.submit();
    expect(rig.status.textContent).toBe(MESSAGES.server);
    expect(rig.resets).toEqual(["widget-7"]);
  });

  it("shows the connection message when the request fails and lets the person try again", async () => {
    const rig = await signupRig(async () => {
      throw new TypeError("offline");
    });
    await rig.submit();
    expect(rig.status).toMatchObject({ textContent: MESSAGES.network, dataset: { kind: "error" } });
    expect(rig.button.disabled).toBe(false);
    expect(rig.resets).toEqual(["widget-7"]);
  });
});

describe("the messages", () => {
  it("are the ones Deacon approved", () => {
    expect(MESSAGES).toEqual({
      success: "You're on the list. We'll email you when EmberWalk launches.",
      invalid_email: "That email address doesn't look right. Please check it and try again.",
      invalid_role: "Please choose the one that describes you best.",
      no_token: "Please wait a moment for the check to finish, then try again.",
      turnstile_failed: "We couldn't confirm you're a person. Please try again.",
      server: "Something went wrong on our end. Please try again, or write to hello@emberwalk.app.",
      network: "We couldn't reach the server. Please check your connection and try again.",
    });
  });
});

describe("start", () => {
  it("reveals the items and sets up the form", async () => {
    const items = [item()];
    const asked: string[] = [];
    const doc = {
      querySelectorAll: () => items,
      getElementById: (id: string) => (asked.push(id), null),
    };
    start(doc, {}, () => Promise.reject(new Error("no")));
    expect([...items[0].classes]).toEqual(["in"]);
    expect(asked).toEqual(["signup"]);
  });
});

import { env, exports } from "cloudflare:workers";
import { DEFAULT_LIMITS, limitsWith, Me, SignInAccepted, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { type SignInDeps, handleSignIn } from "../src/sign-in-route.ts";
import { SESSION_COOKIE, SESSION_DAYS, readSessionToken } from "../src/session-cookie.ts";

const ORIGIN = "https://go.emberwalk.app";
const VISITOR = "c".repeat(64);
const OTHER_VISITOR = "d".repeat(64);
const EMAIL = "manager@example.com";

const CHECK_KEY = "fake-check-key";
const SITE_KEY = "site-key";
const PERSON = "a-real-person";
const SITEVERIFY = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type Sent = { url: string; to: string[]; text: string };

const mailbox = () => {
  const sent: Sent[] = [];
  const checked: URLSearchParams[] = [];
  const send = (async (url: string, init: RequestInit) => {
    if (url === SITEVERIFY) {
      const form = init.body as URLSearchParams;
      checked.push(form);
      return Response.json({ success: form.get("secret") === CHECK_KEY && form.get("response") === PERSON, hostname: "go.emberwalk.app" });
    }
    const body = JSON.parse(String(init.body)) as { to: string[]; text: string };
    sent.push({ url, to: body.to, text: body.text });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return { sent, checked, send };
};

const deps = (over: Partial<SignInDeps> = {}): SignInDeps => ({
  db: env.DB,
  media: env.MEDIA,
  apiKey: "key",
  turnstileSecret: CHECK_KEY,
  turnstileSiteKey: SITE_KEY,
  appOrigin: ORIGIN,
  fetch: mailbox().send,
  now: () => new Date(),
  newId: () => crypto.randomUUID(),
  limits: DEFAULT_LIMITS,
  ...over,
});

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(`https://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: ORIGIN, [VISITOR_HEADER]: VISITOR, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const ask = (d: SignInDeps, email = EMAIL, headers: Record<string, string> = {}, turnstileToken = PERSON) =>
  handleSignIn(post("/api/sign-in", { email, turnstileToken }, headers), d, "/api/sign-in");

const verify = (d: SignInDeps, token: string, headers: Record<string, string> = {}) => handleSignIn(post("/api/sign-in/verify", { token }, headers), d, "/api/sign-in/verify");

const me = (d: SignInDeps, cookie: string | null) =>
  handleSignIn(new Request("https://api.test/api/me", { headers: cookie === null ? {} : { cookie } }), d, "/api/me");

const tokenIn = (mail: Sent): string => {
  const match = /#\/sign-in\/([A-Za-z0-9_-]{43})/.exec(mail.text);
  if (match === null) throw new Error(`no token in: ${mail.text}`);
  return match[1]!;
};

const cookieOf = (response: Response): string => {
  const token = readSessionToken(response.headers.get("set-cookie")?.split(";")[0] ?? null);
  if (token === null) throw new Error("no session cookie");
  return `${SESSION_COOKIE}=${token}`;
};

const code = async (response: Response) => ((await response.json()) as { error: { code: string } }).error.code;

const rows = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n ?? 0;

beforeEach(async () => {
  await env.DB.batch(["sign_in_links", "sessions", "accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("POST /api/sign-in", () => {
  it("asking with an email sends one mail holding one link, and posting its token signs the manager in", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const asked = await ask(d);
    expect(asked.status).toBe(202);
    expect(SignInAccepted.parse(await asked.json())).toEqual({ accepted: true });
    expect(box.sent).toHaveLength(1);
    expect(box.sent[0]?.to).toEqual([EMAIL]);
    const signedIn = await verify(d, tokenIn(box.sent[0]!));
    expect(signedIn.status).toBe(200);
    const cookie = signedIn.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("HttpOnly");
    const seen = await me(d, cookieOf(signedIn));
    expect(seen.status).toBe(200);
    expect(Me.parse(await seen.json()).email).toBe(EMAIL);
  });

  it("the link goes to the app's address and only its hash is stored", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    const token = tokenIn(box.sent[0]!);
    expect(box.sent[0]?.text).toContain(`${ORIGIN}/#/sign-in/${token}`);
    const stored = await env.DB.prepare("SELECT token_hash FROM sign_in_links").first<{ token_hash: string }>();
    expect(stored?.token_hash).not.toBe(token);
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("answers byte for byte the same for a known and an unknown email", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await verify(d, tokenIn((await ask(d), box.sent[0]!)));
    const known = await ask(d, EMAIL);
    const unknown = await ask(d, "nobody@example.com");
    expect(known.status).toBe(unknown.status);
    expect(await known.text()).toBe(await unknown.text());
    expect([...known.headers.entries()]).toEqual([...unknown.headers.entries()]);
  });

  it("makes no account until the link is used", async () => {
    await ask(deps());
    expect(await rows("accounts")).toBe(0);
  });

  it("refuses a sixth link in an hour for one email", async () => {
    const d = deps();
    for (let i = 0; i < 5; i++) expect((await ask(d, EMAIL, { [VISITOR_HEADER]: i % 2 === 0 ? VISITOR : OTHER_VISITOR })).status).toBe(202);
    const sixth = await ask(d, EMAIL);
    expect(sixth.status).toBe(429);
    expect(await code(sixth)).toBe("rate_limited");
  });

  it("refuses an eleventh link in an hour for one phone, and sends no mail for it", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    for (let i = 0; i < 10; i++) expect((await ask(d, `m${i}@example.com`)).status).toBe(202);
    const eleventh = await ask(d, "m11@example.com");
    expect(eleventh.status).toBe(429);
    expect(box.sent).toHaveLength(10);
  });

  it("caps links per network, whatever visitor id the caller picks, and sends no mail past it", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send, limits: limitsWith({ signInLinksPerIpPerHour: 2 }) });
    const from = (n: number, ip: string) => ask(d, `m${n}@example.com`, { [VISITOR_HEADER]: String(n).repeat(64), "cf-connecting-ip": ip });
    expect((await from(1, "203.0.113.7")).status).toBe(202);
    expect((await from(2, "203.0.113.7")).status).toBe(202);
    const third = await from(3, "203.0.113.7");
    expect(third.status).toBe(429);
    expect(await code(third)).toBe("rate_limited");
    expect(box.sent).toHaveLength(2);
    expect((await from(4, "203.0.113.8")).status).toBe(202);
  });

  it("caps links across every caller", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send, limits: limitsWith({ signInLinksPerHour: 2 }) });
    const from = (n: number) => ask(d, `m${n}@example.com`, { [VISITOR_HEADER]: String(n).repeat(64), "cf-connecting-ip": `203.0.113.${n}` });
    expect((await from(1)).status).toBe(202);
    expect((await from(2)).status).toBe(202);
    expect((await from(3)).status).toBe(429);
    expect(box.sent).toHaveLength(2);
  });

  it("keeps no network address in clear", async () => {
    await ask(deps(), EMAIL, { "cf-connecting-ip": "203.0.113.7" });
    const row = await env.DB.prepare("SELECT ip_hash FROM sign_in_links").first<{ ip_hash: string }>();
    expect(row?.ip_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("counts only the last hour", async () => {
    let at = Date.parse("2026-11-01T10:00:00.000Z");
    const d = deps({ now: () => new Date(at) });
    for (let i = 0; i < 5; i++) await ask(d);
    at += 3_600_001;
    expect((await ask(d)).status).toBe(202);
  });

  it.each([
    ["no body", "", 400, "invalid_request"],
    ["a broken body", "{", 400, "invalid_request"],
    ["a bad email", { email: "not an email" }, 400, "invalid_request"],
    ["an extra field", { email: EMAIL, admin: true }, 400, "invalid_request"],
  ])("refuses %s", async (_name, body, status, wanted) => {
    const reply = await handleSignIn(post("/api/sign-in", body), deps(), "/api/sign-in");
    expect(reply.status).toBe(status);
    expect(await code(reply)).toBe(wanted);
    expect(await rows("sign_in_links")).toBe(0);
  });

  it("refuses a phone with no visitor id", async () => {
    const reply = await ask(deps(), EMAIL, { [VISITOR_HEADER]: "nope" });
    expect(reply.status).toBe(400);
  });

  it("refuses the wrong method", async () => {
    const reply = await handleSignIn(new Request("https://api.test/api/sign-in"), deps(), "/api/sign-in");
    expect(reply.status).toBe(405);
    expect(await code(reply)).toBe("method_not_allowed");
  });

  it("refuses a POST from another origin and sends nothing", async () => {
    const box = mailbox();
    const reply = await ask(deps({ fetch: box.send }), EMAIL, { origin: "https://evil.example" });
    expect(reply.status).toBe(403);
    expect(await code(reply)).toBe("forbidden_origin");
    expect(box.sent).toHaveLength(0);
  });

  it("refuses a POST with no origin", async () => {
    const request = new Request("https://api.test/api/sign-in", { method: "POST", headers: { [VISITOR_HEADER]: VISITOR }, body: JSON.stringify({ email: EMAIL }) });
    expect((await handleSignIn(request, deps(), "/api/sign-in")).status).toBe(403);
  });

  it("answers 503 with no key, stores no link", async () => {
    const box = mailbox();
    const reply = await ask(deps({ apiKey: undefined, fetch: box.send }));
    expect(reply.status).toBe(503);
    expect(await code(reply)).toBe("not_set_up");
    expect(box.sent).toHaveLength(0);
    expect(await rows("sign_in_links")).toBe(0);
  });

  it.each([
    ["a Resend 500", async () => new Response("{}", { status: 500 })],
    ["a Resend 422", async () => new Response("{}", { status: 422 })],
    [
      "a dropped connection",
      async () => {
        throw new Error("down");
      },
    ],
  ])("%s answers mail_failed and stores no link, so it spends none of the hour's limit", async (_name, send) => {
    const box = mailbox();
    const mail = send as unknown as typeof fetch;
    const reply = await ask(deps({ fetch: ((url: string, init: RequestInit) => (url === SITEVERIFY ? box.send(url, init) : mail(url, init))) as typeof fetch }));
    expect(reply.status).toBe(502);
    expect(await code(reply)).toBe("mail_failed");
    expect(await rows("sign_in_links")).toBe(0);
  });
});

describe("the person check on asking for a link", () => {
  it("checks the token with the secret before any mail goes", async () => {
    const box = mailbox();
    expect((await ask(deps({ fetch: box.send }))).status).toBe(202);
    expect(box.checked).toHaveLength(1);
    expect(box.checked[0]?.get("secret")).toBe(CHECK_KEY);
    expect(box.checked[0]?.get("response")).toBe(PERSON);
    expect(box.sent).toHaveLength(1);
  });

  it.each([
    ["no token", { email: EMAIL }],
    ["an empty token", { email: EMAIL, turnstileToken: "" }],
    ["a token the check refuses", { email: EMAIL, turnstileToken: "a-program" }],
  ])("%s is refused with no mail and no link", async (_name, body) => {
    const box = mailbox();
    const reply = await handleSignIn(post("/api/sign-in", body), deps({ fetch: box.send }), "/api/sign-in");
    expect(reply.status).toBe(403);
    expect(await code(reply)).toBe("check_failed");
    expect(box.sent).toHaveLength(0);
    expect(await rows("sign_in_links")).toBe(0);
  });

  it("a token made on another site is refused", async () => {
    const box = mailbox();
    const send = ((url: string, init: RequestInit) => (url === SITEVERIFY ? Promise.resolve(Response.json({ success: true, hostname: "evil.example" })) : box.send(url, init))) as typeof fetch;
    const reply = await ask(deps({ fetch: send }));
    expect(reply.status).toBe(403);
    expect(await code(reply)).toBe("check_failed");
    expect(box.sent).toHaveLength(0);
  });

  it("gives up on a check that hangs, with a time limit on the call", async () => {
    let limited = false;
    const send = (async (url: string, init: RequestInit) => {
      if (url === SITEVERIFY) limited = init.signal instanceof AbortSignal;
      return Response.json({ success: false });
    }) as typeof fetch;
    await ask(deps({ fetch: send }));
    expect(limited).toBe(true);
  });

  it("writes the mail in the language the phone asks in", async () => {
    const box = mailbox();
    await handleSignIn(post("/api/sign-in", { email: EMAIL, turnstileToken: PERSON, language: "es" }), deps({ fetch: box.send }), "/api/sign-in");
    expect(box.sent[0]?.text).toContain("toque este enlace");
    const english = mailbox();
    await ask(deps({ fetch: english.send }));
    expect(english.sent[0]?.text).toContain("tap this link");
  });

  it("a refused token spends none of the hour's limit", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    for (let i = 0; i < 6; i++) await ask(d, EMAIL, {}, "a-program");
    expect((await ask(d)).status).toBe(202);
  });

  it.each([
    ["answers 500", async () => new Response("{}", { status: 500 })],
    [
      "cannot be reached",
      async () => {
        throw new Error("down");
      },
    ],
  ])("when the check %s, no mail goes and the phone is told to try again", async (_name, send) => {
    const reply = await ask(deps({ fetch: send as unknown as typeof fetch }));
    expect(reply.status).toBe(503);
    expect(await code(reply)).toBe("check_unavailable");
    expect(await rows("sign_in_links")).toBe(0);
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
  ])("a %s secret is red: nothing is checked or sent", async (_name, turnstileSecret) => {
    const box = mailbox();
    const reply = await ask(deps({ fetch: box.send, turnstileSecret }));
    expect(reply.status).toBe(503);
    expect(await code(reply)).toBe("not_set_up");
    expect(box.checked).toHaveLength(0);
    expect(box.sent).toHaveLength(0);
    expect(await rows("sign_in_links")).toBe(0);
  });

  it("takes the longest token the check issues, and refuses a longer one", async () => {
    const box = mailbox();
    const longest = "a".repeat(2048);
    await ask(deps({ fetch: box.send }), EMAIL, {}, longest);
    expect(box.checked[0]?.get("response")).toBe(longest);
    expect((await ask(deps({ fetch: box.send }), EMAIL, {}, "a".repeat(2049))).status).toBe(400);
  });
});

describe("GET /api/sign-in/config", () => {
  const config = (d: SignInDeps, method = "GET") => handleSignIn(new Request("https://api.test/api/sign-in/config", { method, headers: { origin: ORIGIN } }), d, "/api/sign-in/config");

  it("gives the phone the site key and nothing else", async () => {
    const reply = await config(deps());
    expect(reply.status).toBe(200);
    expect(await reply.json()).toEqual({ turnstileSiteKey: SITE_KEY });
  });

  it("with no site key answers not_set_up", async () => {
    const reply = await config(deps({ turnstileSiteKey: undefined }));
    expect(reply.status).toBe(503);
    expect(await code(reply)).toBe("not_set_up");
  });

  it("refuses the wrong method", async () => {
    expect((await config(deps(), "POST")).status).toBe(405);
  });
});

describe("POST /api/sign-in/verify", () => {
  const linked = async (d: SignInDeps, box: ReturnType<typeof mailbox>) => {
    await ask(d);
    return tokenIn(box.sent.at(-1)!);
  };

  it("uses a link once", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const token = await linked(d, box);
    expect((await verify(d, token)).status).toBe(200);
    const again = await verify(d, token);
    expect(again.status).toBe(409);
    expect(await code(again)).toBe("link_used");
    expect(again.headers.get("set-cookie")).toBeNull();
  });

  it("refuses an expired link and signs nobody in", async () => {
    let at = Date.parse("2026-11-01T10:00:00.000Z");
    const box = mailbox();
    const d = deps({ fetch: box.send, now: () => new Date(at) });
    const token = await linked(d, box);
    at += 15 * 60_000 + 1;
    const reply = await verify(d, token);
    expect(reply.status).toBe(410);
    expect(await code(reply)).toBe("link_expired");
    expect(await rows("sessions")).toBe(0);
    expect(await rows("accounts")).toBe(0);
  });

  it("refuses an altered token and signs nobody in", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const token = await linked(d, box);
    const altered = `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`;
    const reply = await verify(d, altered);
    expect(reply.status).toBe(400);
    expect(await code(reply)).toBe("link_invalid");
    expect(await rows("sessions")).toBe(0);
  });

  it("refuses a malformed token", async () => {
    const reply = await verify(deps(), "short");
    expect(reply.status).toBe(400);
    expect(await code(reply)).toBe("invalid_request");
  });

  it("refuses another origin and leaves the link good", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const token = await linked(d, box);
    expect((await verify(d, token, { origin: "https://evil.example" })).status).toBe(403);
    expect((await verify(d, token)).status).toBe(200);
  });

  it("makes the account once: a second sign in finds the same one", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const first = await me(d, cookieOf(await verify(d, await linked(d, box))));
    const second = await me(d, cookieOf(await verify(d, await linked(d, box))));
    expect(Me.parse(await second.json()).accountId).toBe(Me.parse(await first.json()).accountId);
    expect(await rows("accounts")).toBe(1);
  });

  it("ties the session to the phone stored on the link, and a header naming another phone changes nothing but the proof", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await verify(d, await linked(d, box), { [VISITOR_HEADER]: OTHER_VISITOR });
    const row = await env.DB.prepare("SELECT visitor_id, same_phone FROM sessions").first<{ visitor_id: string; same_phone: number }>();
    expect(row).toEqual({ visitor_id: VISITOR, same_phone: 0 });
  });

  it("a link opened on another phone signs in, and that phone can read the account's email", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const opened = await verify(d, await linked(d, box), { [VISITOR_HEADER]: OTHER_VISITOR });
    expect(opened.status).toBe(200);
    const seen = await me(d, cookieOf(opened));
    expect(seen.status).toBe(200);
    expect(Me.parse(await seen.json()).email).toBe(EMAIL);
  });

  it("marks a session opened on the phone that asked", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await verify(d, await linked(d, box));
    const row = await env.DB.prepare("SELECT visitor_id, same_phone FROM sessions").first<{ visitor_id: string; same_phone: number }>();
    expect(row).toEqual({ visitor_id: VISITOR, same_phone: 1 });
  });
});

const codeIn = (mail: Sent): string => {
  const match = /\b(\d{3}) (\d{3})\b/.exec(mail.text);
  if (match === null) throw new Error(`no code in: ${mail.text}`);
  return `${match[1]}${match[2]}`;
};

const enter = (d: SignInDeps, typed: string, email = EMAIL, headers: Record<string, string> = {}) =>
  handleSignIn(post("/api/sign-in/verify", { email, code: typed }, headers), d, "/api/sign-in/verify");

const otherCode = (right: string): string => String((Number(right) + 1) % 1_000_000).padStart(6, "0");

describe("signing in with the code in the mail", () => {
  it("the mail holds a six digit code, and typing it on the phone that asked signs in", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    const signedIn = await enter(d, codeIn(box.sent[0]!));
    expect(signedIn.status).toBe(200);
    const seen = await me(d, cookieOf(signedIn));
    expect(Me.parse(await seen.json()).email).toBe(EMAIL);
  });

  it("an email written in capitals still finds its code", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    expect((await enter(d, codeIn(box.sent[0]!), EMAIL.toUpperCase())).status).toBe(200);
  });

  it("refuses the right code typed on another phone", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    const elsewhere = await enter(d, codeIn(box.sent[0]!), EMAIL, {
      [VISITOR_HEADER]: OTHER_VISITOR,
    });
    expect(elsewhere.status).toBe(400);
    expect(await code(elsewhere)).toBe("code_wrong");
    expect(await rows("sessions")).toBe(0);
  });

  it("refuses a wrong code, and after five wrong codes the right one no longer works", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    const right = codeIn(box.sent[0]!);
    const wrong = await enter(d, otherCode(right));
    expect(wrong.status).toBe(400);
    expect(await code(wrong)).toBe("code_wrong");
    for (let i = 0; i < 3; i++) await enter(d, otherCode(right));
    const fifth = await enter(d, otherCode(right));
    expect(await code(fifth)).toBe("code_tries");
    const late = await enter(d, right);
    expect(late.status).not.toBe(200);
    expect(await rows("sessions")).toBe(0);
  });

  it("the code and the link are one: once the link is used the code is used too", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    expect((await verify(d, tokenIn(box.sent[0]!))).status).toBe(200);
    expect((await enter(d, codeIn(box.sent[0]!))).status).not.toBe(200);
  });

  it("the code ends with its link after 15 minutes", async () => {
    let at = Date.parse("2026-11-03T10:00:00.000Z");
    const box = mailbox();
    const d = deps({ fetch: box.send, now: () => new Date(at) });
    await ask(d);
    at += 15 * 60_000 + 1;
    const late = await enter(d, codeIn(box.sent[0]!));
    expect(late.status).toBe(410);
    expect(await code(late)).toBe("link_expired");
  });

  it("keeps only a hash of the code", async () => {
    const box = mailbox();
    await ask(deps({ fetch: box.send }));
    const row = await env.DB.prepare("SELECT code_hash FROM sign_in_links").first<{ code_hash: string }>();
    expect(row?.code_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.code_hash).not.toContain(codeIn(box.sent[0]!));
  });

  it.each([
    ["five digits", "12345"],
    ["letters", "12a456"],
    ["a token and a code at once", null],
  ])("refuses %s", async (_name, typed) => {
    const body = typed === null ? { token: "A".repeat(43), email: EMAIL, code: "123456" } : { email: EMAIL, code: typed };
    const reply = await handleSignIn(post("/api/sign-in/verify", body), deps(), "/api/sign-in/verify");
    expect(reply.status).toBe(400);
    expect(await code(reply)).toBe("invalid_request");
  });
});

describe("staying signed in", () => {
  it("each visit pushes the session's end a full term forward and sets the cookie again", async () => {
    let at = Date.parse("2026-11-03T10:00:00.000Z");
    const box = mailbox();
    const d = deps({ fetch: box.send, now: () => new Date(at) });
    await ask(d);
    const cookie = cookieOf(await enter(d, codeIn(box.sent[0]!)));
    at += (SESSION_DAYS - 1) * 86_400_000;
    const visit = await me(d, cookie);
    expect(visit.status).toBe(200);
    expect(visit.headers.get("set-cookie")).toContain(`Max-Age=${SESSION_DAYS * 86_400}`);
    at += 2 * 86_400_000;
    expect((await me(d, cookie)).status).toBe(200);
  });

  it("a session not visited for a full term has ended", async () => {
    let at = Date.parse("2026-11-03T10:00:00.000Z");
    const box = mailbox();
    const d = deps({ fetch: box.send, now: () => new Date(at) });
    await ask(d);
    const cookie = cookieOf(await enter(d, codeIn(box.sent[0]!)));
    at += SESSION_DAYS * 86_400_000 + 1;
    expect((await me(d, cookie)).status).toBe(401);
  });

  it("a signed out session is refused at /api/me and its end does not move", async () => {
    let at = Date.parse("2026-11-03T10:00:00.000Z");
    const box = mailbox();
    const d = deps({ fetch: box.send, now: () => new Date(at) });
    await ask(d);
    const cookie = cookieOf(await enter(d, codeIn(box.sent[0]!)));
    await handleSignIn(post("/api/sign-out", {}, { cookie }), d, "/api/sign-out");
    const before = await env.DB.prepare("SELECT expires_at FROM sessions").first<{ expires_at: string }>();
    at += 86_400_000;
    const visit = await me(d, cookie);
    expect(visit.status).toBe(401);
    expect(visit.headers.get("set-cookie")).toBeNull();
    expect(await env.DB.prepare("SELECT expires_at FROM sessions").first<{ expires_at: string }>()).toEqual(before);
  });

  it("a deleted account's cookie is refused at /api/me and sets no cookie", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d);
    const cookie = cookieOf(await enter(d, codeIn(box.sent[0]!)));
    await env.DB.prepare("DELETE FROM accounts").run();
    const visit = await me(d, cookie);
    expect(visit.status).toBe(401);
    expect(visit.headers.get("set-cookie")).toBeNull();
    expect(await rows("sessions")).toBe(0);
  });
});

const NEW_EMAIL = "new-address@example.com";

const signedInWithCode = async (d: SignInDeps, box: ReturnType<typeof mailbox>): Promise<string> => {
  await ask(d);
  return cookieOf(await enter(d, codeIn(box.sent.at(-1)!)));
};

const askChange = (d: SignInDeps, cookie: string | null, email = NEW_EMAIL, headers: Record<string, string> = {}) =>
  handleSignIn(post("/api/me/email", { email }, cookie === null ? headers : { cookie, ...headers }), d, "/api/me/email");

const confirmChange = (d: SignInDeps, cookie: string, typed: string, email = NEW_EMAIL, headers: Record<string, string> = {}) =>
  handleSignIn(post("/api/me/email/verify", { email, code: typed }, { cookie, ...headers }), d, "/api/me/email/verify");

describe("changing the account's email", () => {
  it("sends a code to the new address only, and typing it moves the account to the new address", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const cookie = await signedInWithCode(d, box);
    expect((await askChange(d, cookie)).status).toBe(202);
    const mail = box.sent.at(-1)!;
    expect(mail.to).toEqual([NEW_EMAIL]);
    expect(mail.text).not.toMatch(/#\/sign-in\//);
    const moved = await confirmChange(d, cookie, codeIn(mail));
    expect(moved.status).toBe(200);
    expect(Me.parse(await moved.json()).email).toBe(NEW_EMAIL);
    expect(Me.parse(await (await me(d, cookie)).json()).email).toBe(NEW_EMAIL);
  });

  it("refuses to change the email without a session", async () => {
    const reply = await askChange(deps(), null);
    expect(reply.status).toBe(401);
  });

  it("a wrong code leaves the email as it was", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const cookie = await signedInWithCode(d, box);
    await askChange(d, cookie);
    const wrong = await confirmChange(d, cookie, otherCode(codeIn(box.sent.at(-1)!)));
    expect(await code(wrong)).toBe("code_wrong");
    expect(Me.parse(await (await me(d, cookie)).json()).email).toBe(EMAIL);
  });

  it("the change code never signs anyone in", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const cookie = await signedInWithCode(d, box);
    await askChange(d, cookie);
    const reply = await enter(d, codeIn(box.sent.at(-1)!), NEW_EMAIL);
    expect(reply.status).not.toBe(200);
    expect(await rows("accounts")).toBe(1);
  });

  it("a sign in code never changes an email", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const cookie = await signedInWithCode(d, box);
    await ask(d, NEW_EMAIL);
    const reply = await confirmChange(d, cookie, codeIn(box.sent.at(-1)!));
    expect(reply.status).not.toBe(200);
    expect(Me.parse(await (await me(d, cookie)).json()).email).toBe(EMAIL);
  });

  it("refuses an address another account already has", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    await ask(d, NEW_EMAIL, { [VISITOR_HEADER]: OTHER_VISITOR });
    await enter(d, codeIn(box.sent.at(-1)!), NEW_EMAIL, {
      [VISITOR_HEADER]: OTHER_VISITOR,
    });
    const cookie = await signedInWithCode(d, box);
    await askChange(d, cookie);
    const taken = await confirmChange(d, cookie, codeIn(box.sent.at(-1)!));
    expect(taken.status).toBe(409);
    expect(await code(taken)).toBe("email_taken");
    expect(Me.parse(await (await me(d, cookie)).json()).email).toBe(EMAIL);
  });

  it("a change code works only for the account that asked for it, even on the same phone", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const asker = await signedInWithCode(d, box);
    await ask(d, "second@example.com");
    const other = cookieOf(await enter(d, codeIn(box.sent.at(-1)!), "second@example.com"));
    await askChange(d, asker);
    const stolen = await confirmChange(d, other, codeIn(box.sent.at(-1)!));
    expect(stolen.status).not.toBe(200);
    expect(Me.parse(await (await me(d, other)).json()).email).toBe("second@example.com");
    expect(Me.parse(await (await me(d, asker)).json()).email).toBe(EMAIL);
  });

  it("changing the email ends every other session of the account and keeps this one", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const here = await signedInWithCode(d, box);
    await ask(d, EMAIL, { [VISITOR_HEADER]: OTHER_VISITOR });
    const elsewhere = cookieOf(await enter(d, codeIn(box.sent.at(-1)!), EMAIL, { [VISITOR_HEADER]: OTHER_VISITOR }));
    await askChange(d, here);
    expect((await confirmChange(d, here, codeIn(box.sent.at(-1)!))).status).toBe(200);
    expect((await me(d, here)).status).toBe(200);
    expect((await me(d, elsewhere)).status).toBe(401);
  });

  it("counts change codes against the hourly limit for the new address", async () => {
    const box = mailbox();
    const d = deps({ fetch: box.send });
    const cookie = await signedInWithCode(d, box);
    for (let i = 0; i < 5; i++) expect((await askChange(d, cookie)).status).toBe(202);
    expect((await askChange(d, cookie)).status).toBe(429);
  });
});

describe("the Worker", () => {
  it("routes every sign in path", async () => {
    for (const path of ["/api/sign-in", "/api/sign-in/verify", "/api/sign-out"]) {
      const reply = await exports.default.fetch(new Request(`https://api.test${path}`));
      expect(reply.status, path).toBe(405);
    }
    expect((await exports.default.fetch(new Request("https://api.test/api/me"))).status).toBe(401);
    expect((await exports.default.fetch(new Request("https://api.test/api/sign-in/config", { method: "POST" }))).status).toBe(405);
  });
});

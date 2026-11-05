import { env } from "cloudflare:workers";
import { findOrCreateAccount, startSession } from "@emberwalk/db";
import { DEFAULT_LIMITS, VISITOR_HEADER } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { accountOf, sameOrigin } from "../src/account.ts";
import { SESSION_COOKIE, SESSION_DAYS, newSessionToken, sessionExpiry } from "../src/session-cookie.ts";
import { handleSignIn } from "../src/sign-in-route.ts";

const ORIGIN = "https://go.emberwalk.app";
const VISITOR = "c".repeat(64);
const NOW = new Date("2026-11-01T10:00:00.000Z");

const signedIn = async (email = "manager@example.com", at = NOW) => {
  const account = await findOrCreateAccount(env.DB, { id: crypto.randomUUID(), email, at: at.toISOString() });
  const { token, hash } = await newSessionToken();
  await startSession(env.DB, { tokenHash: hash, accountId: account.id, visitorId: VISITOR, createdAt: at.toISOString(), expiresAt: sessionExpiry(at) });
  return { account, cookie: `${SESSION_COOKIE}=${token}` };
};

const asked = (cookie?: string) => new Request("https://api.test/api/me", cookie === undefined ? {} : { headers: { cookie } });

beforeEach(async () => {
  await env.DB.batch(["sessions", "accounts"].map((t) => env.DB.prepare(`DELETE FROM ${t}`)));
});

describe("accountOf", () => {
  it("names the signed in account", async () => {
    const { account, cookie } = await signedIn();
    expect((await accountOf(asked(cookie), env.DB, NOW))?.account.id).toBe(account.id);
  });

  it.each([
    ["no cookie", undefined],
    ["an unknown token", `${SESSION_COOKIE}=${"A".repeat(43)}`],
    ["a malformed token", `${SESSION_COOKIE}=short`],
  ])("reads %s as signed out", async (_name, cookie) => {
    await signedIn();
    expect(await accountOf(asked(cookie), env.DB, NOW)).toBeNull();
  });

  it("reads a session past its term as signed out", async () => {
    const { cookie } = await signedIn();
    expect(await accountOf(asked(cookie), env.DB, new Date(NOW.getTime() + (SESSION_DAYS + 1) * 86_400_000))).toBeNull();
  });
});

describe("POST /api/sign-out", () => {
  const out = (cookie: string | undefined, headers: Record<string, string> = {}) =>
    handleSignIn(
      new Request("https://api.test/api/sign-out", { method: "POST", headers: { origin: ORIGIN, [VISITOR_HEADER]: VISITOR, ...(cookie === undefined ? {} : { cookie }), ...headers } }),
      { db: env.DB, media: env.MEDIA, apiKey: "key", turnstileSecret: undefined, turnstileSiteKey: undefined, appOrigin: ORIGIN, fetch: globalThis.fetch, now: () => NOW, newId: () => crypto.randomUUID(), limits: DEFAULT_LIMITS },
      "/api/sign-out",
    );

  it("ends the session on the server: the old cookie reads as signed out afterwards", async () => {
    const { cookie } = await signedIn();
    const reply = await out(cookie);
    expect(reply.status).toBe(204);
    expect(reply.headers.get("set-cookie")).toContain("Max-Age=0");
    expect(await accountOf(asked(cookie), env.DB, NOW)).toBeNull();
  });

  it("answers the same when already signed out", async () => {
    expect((await out(undefined)).status).toBe(204);
  });

  it("refuses another origin and keeps the session", async () => {
    const { cookie } = await signedIn();
    expect((await out(cookie, { origin: "https://evil.example" })).status).toBe(403);
    expect(await accountOf(asked(cookie), env.DB, NOW)).not.toBeNull();
  });
});

describe("sameOrigin", () => {
  const withOrigin = (origin?: string) => new Request("https://api.test/", { method: "POST", headers: origin === undefined ? {} : { origin } });

  it("passes only the app's own origin", () => {
    expect(sameOrigin(withOrigin(ORIGIN), ORIGIN)).toBe(true);
    expect(sameOrigin(withOrigin("https://go.emberwalk.app.evil.example"), ORIGIN)).toBe(false);
    expect(sameOrigin(withOrigin(), ORIGIN)).toBe(false);
  });

  it("refuses everything when the app's origin is not set", () => {
    expect(sameOrigin(withOrigin(ORIGIN), undefined)).toBe(false);
    expect(sameOrigin(withOrigin("null"), undefined)).toBe(false);
  });
});

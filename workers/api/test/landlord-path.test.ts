import { env } from "cloudflare:workers";
import { VISITOR_HEADER } from "@emberwalk/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index.ts";
import { clearPortfolios } from "./portfolio-seed.ts";

const ORIGIN = "https://go.emberwalk.app";
const PHONE = "c".repeat(64);
const SECOND_PHONE = "d".repeat(64);
const EMAIL = "manager@example.com";

const live = { ...env, APP_ORIGIN: ORIGIN, RESEND_API_KEY: "key", TURNSTILE_SECRET: "secret", TURNSTILE_SITE_KEY: "site-key" };

const seenWords: string[] = [];

const call = async (method: string, path: string, o: { body?: unknown; cookie?: string; phone?: string } = {}) => {
  const request = new Request(`https://go.emberwalk.app${path}`, {
    method,
    headers: {
      origin: ORIGIN,
      [VISITOR_HEADER]: o.phone ?? PHONE,
      ...(o.cookie === undefined ? {} : { cookie: o.cookie }),
      ...(o.body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(o.body === undefined ? {} : { body: JSON.stringify(o.body) }),
  });
  const reply = await worker.fetch(request as never, live as never);
  const text = await reply.clone().text();
  seenWords.push(text);
  return { status: reply.status, text, setCookie: reply.headers.get("set-cookie") };
};

let mail: string[];

beforeEach(async () => {
  await clearPortfolios();
  await env.DB.prepare("DELETE FROM sign_in_links").run();
  mail = [];
  seenWords.length = 0;
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    if (String(url).includes("siteverify")) return Response.json({ success: true, hostname: "go.emberwalk.app" });
    mail.push((JSON.parse(String(init.body)) as { text: string }).text);
    return new Response("{}");
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const signIn = async (openedOn: string) => {
  expect((await call("GET", "/api/sign-in/config")).text).toContain("site-key");
  expect((await call("POST", "/api/sign-in", { body: { email: EMAIL, turnstileToken: "t" } })).status).toBe(202);
  const token = /#\/sign-in\/([A-Za-z0-9_-]{43})/.exec(mail.at(-1) ?? "")?.[1];
  const opened = await call("POST", "/api/sign-in/verify", { body: { token }, phone: openedOn });
  expect(opened.status).toBe(200);
  return opened.setCookie?.split(";")[0] ?? "";
};

describe("a landlord with the private lock off and no lock token on any request", () => {
  it.each([
    ["the phone that asked", PHONE],
    ["a second phone", SECOND_PHONE],
  ])("signs in on %s, adds a home, invites a tenant, reads the record and signs out", async (_name, phone) => {
    const cookie = await signIn(phone);
    const me = await call("GET", "/api/me", { cookie, phone });
    expect(me.status).toBe(200);
    expect(me.text).toContain(EMAIL);
    const added = await call("POST", "/api/properties", { cookie, phone, body: { label: "Cedar Lane" } });
    expect(added.status).toBe(201);
    const home = (JSON.parse(added.text) as { id: string }).id;
    expect((await call("GET", "/api/properties", { cookie, phone })).status).toBe(200);
    expect((await call("GET", `/api/properties/${home}`, { cookie, phone })).status).toBe(200);
    const invite = await call("POST", `/api/properties/${home}/invites`, { cookie, phone });
    expect(invite.status).toBe(201);
    const { code } = JSON.parse(invite.text) as { code: string };
    expect((await call("GET", `/api/invites/${code}`, { phone: "e".repeat(64) })).status).toBe(200);
    expect((await call("GET", `/api/properties/${home}/record`)).status).toBe(401);
    expect((await call("POST", "/api/sign-out", { cookie, phone })).status).toBe(204);
    expect((await call("GET", "/api/me", { cookie, phone })).status).toBe(401);
    expect(seenWords.join(" ")).not.toMatch(/cloudflare|zero trust|\baccess\b/i);
  });

  it("with the secret missing, asking for a link is refused and no mail goes", async () => {
    const reply = await worker.fetch(
      new Request("https://go.emberwalk.app/api/sign-in", { method: "POST", headers: { origin: ORIGIN, [VISITOR_HEADER]: PHONE }, body: JSON.stringify({ email: EMAIL, turnstileToken: "t" }) }) as never,
      { ...live, TURNSTILE_SECRET: undefined } as never,
    );
    expect(reply.status).toBe(503);
    expect(mail).toHaveLength(0);
  });
});

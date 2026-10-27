import { env } from "cloudflare:workers";
import type { Deps, Env, Mailer, Message } from "../src/types";

export const TURNSTILE_PASS_SECRET = "1x0000000000000000000000000000000AA";
export const TURNSTILE_FAIL_SECRET = "2x0000000000000000000000000000000AA";
export const TEST_SIGNING_VALUE = "unit-test-signing-value";

export function testEnv(overrides: Partial<Env> = {}): Env {
  return { ...env, TURNSTILE_SECRET: TURNSTILE_PASS_SECRET, UNSUBSCRIBE_SECRET: TEST_SIGNING_VALUE, ...overrides };
}

export interface FakeVerify {
  fetch: typeof fetch;
  calls: { url: string; body: URLSearchParams }[];
}

export function fakeVerify(behavior: "pass" | "fail" | "throw" | "bad-json" = "pass"): FakeVerify {
  const calls: FakeVerify["calls"] = [];
  const fetchFake = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: new URLSearchParams(String(init?.body ?? "")) });
    if (behavior === "throw") throw new TypeError("network down");
    if (behavior === "bad-json") return new Response("not json", { status: 200 });
    return Response.json({ success: behavior === "pass", "error-codes": [] });
  };
  return { fetch: fetchFake as typeof fetch, calls };
}

export interface FakeMailer extends Mailer {
  sent: Message[];
}

export function fakeMailer(fail = false): FakeMailer {
  const sent: Message[] = [];
  return {
    sent,
    async send(message) {
      if (fail) throw new Error("resend refused");
      sent.push(message);
    },
  };
}

export function deps(verify: FakeVerify, mailer: Mailer | null): Deps {
  return { fetchImpl: verify.fetch, mailer };
}

export function signupRequest(body: unknown, init: RequestInit = {}): Request {
  return new Request("https://emberwalk.app/api/signup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  });
}

export const validBody = {
  email: "Neighbor@Example.com",
  role: "homeowner",
  turnstileToken: "XXXX.DUMMY.TOKEN.XXXX",
};

export async function rows(db: D1Database) {
  const result = await db.prepare("SELECT * FROM signups ORDER BY id").all<Record<string, unknown>>();
  return result.results;
}

export async function clearSignups(db: D1Database) {
  await db.prepare("DELETE FROM signups").run();
}

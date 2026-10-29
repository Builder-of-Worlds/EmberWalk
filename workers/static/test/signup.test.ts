import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { createResendMailer } from "../src/resend";
import { readToken } from "../src/unsubscribe";
import { TEST_SIGNING_VALUE, clearSignups, deps, fakeMailer, fakeVerify, rows, signupRequest, testEnv, validBody } from "./helpers";

const SIGNUP = "https://emberwalk.app/api/signup";

async function post(body: unknown, options: { verify?: ReturnType<typeof fakeVerify>; mailer?: ReturnType<typeof fakeMailer> | null; env?: ReturnType<typeof testEnv> } = {}) {
  const verify = options.verify ?? fakeVerify("pass");
  const mailer = options.mailer === undefined ? fakeMailer() : options.mailer;
  const env = options.env ?? testEnv();
  const response = await handle(signupRequest(body), env, deps(verify, mailer));
  return { response, verify, mailer, env };
}

beforeEach(async () => {
  await clearSignups(testEnv().DB);
});

describe("POST /api/signup, normal", () => {
  it("stores the row, sends one welcome email and marks it sent", async () => {
    const { response, verify, mailer, env } = await post(validBody);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });

    const stored = await rows(env.DB);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ email: "neighbor@example.com", role: "homeowner" });
    expect(stored[0].created_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(stored[0].welcomed_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    expect(mailer!.sent).toHaveLength(1);
    expect(mailer!.sent[0]).toMatchObject({ to: "neighbor@example.com", subject: "You're on the list" });
    expect(mailer!.sent[0].body.length).toBeGreaterThan(20);
    expect(verify.calls).toHaveLength(1);
  });

  it("puts a working unsubscribe link for that address in the welcome email", async () => {
    const { mailer } = await post(validBody);
    const link = mailer!.sent[0].unsubscribeUrl;
    expect(link.startsWith("https://emberwalk.app/unsubscribe?t=")).toBe(true);
    expect(await readToken(new URL(link).searchParams.get("t")!, TEST_SIGNING_VALUE)).toBe("neighbor@example.com");
  });

  it("stores an apostrophe in the address literally and leaves the table intact", async () => {
    const { response, env } = await post({ ...validBody, email: "o'brien@example.com" });
    expect(response.status).toBe(200);
    expect((await rows(env.DB)).map((row) => row.email)).toEqual(["o'brien@example.com"]);
  });

  it("stores only the email and role it is given, ignoring extra fields", async () => {
    const { response, env } = await post({ ...validBody, address: "1 Main St", phone: "555" });
    expect(response.status).toBe(200);
    expect(Object.keys((await rows(env.DB))[0]).sort()).toEqual(["created_at", "email", "id", "role", "welcomed_at"]);
  });
});

describe("POST /api/signup, where the address goes", () => {
  it("is sent only to Cloudflare Turnstile (the token) and Resend (the welcome email)", async () => {
    const hosts: string[] = [];
    const bodies: string[] = [];
    const outbound = (async (input: RequestInfo | URL, init?: RequestInit) => {
      hosts.push(new URL(String(input)).host);
      bodies.push(String(init?.body ?? ""));
      return Response.json({ success: true, id: "email_1" });
    }) as unknown as typeof fetch;
    const env = testEnv();
    const response = await handle(signupRequest(validBody), env, { fetchImpl: outbound, mailer: createResendMailer("re_test_key", "EmberWalk, Sender Name, 1 Example Street, Example City, CA 00000", outbound) });
    expect(response.status).toBe(200);
    expect(hosts).toEqual(["challenges.cloudflare.com", "api.resend.com"]);
    expect(bodies[0]).not.toContain("neighbor");
    expect(bodies[1]).toContain("neighbor@example.com");
  });

  it("stores the signup and sends no email when the postal address setting is missing", async () => {
    const hosts: string[] = [];
    const outbound = (async (input: RequestInfo | URL) => {
      hosts.push(new URL(String(input)).host);
      return Response.json({ success: true, id: "email_1" });
    }) as unknown as typeof fetch;
    const env = testEnv();
    const response = await handle(signupRequest(validBody), env, { fetchImpl: outbound, mailer: createResendMailer("re_test_key", undefined, outbound) });
    expect(response.status).toBe(200);
    expect(hosts).toEqual(["challenges.cloudflare.com"]);
    const stored = await rows(env.DB);
    expect(stored).toHaveLength(1);
    expect(stored[0].welcomed_at).toBeNull();
  });
});

describe("POST /api/signup, invalid", () => {
  it.each([
    ["a bad email", { ...validBody, email: "nope" }, "invalid_email"],
    ["a bad role", { ...validBody, role: "admin" }, "invalid_role"],
    ["a body that is not an object", [1, 2], "invalid_body"],
  ])("refuses %s with 400 and does nothing else", async (_name, body, error) => {
    const { response, verify, mailer, env } = await post(body);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error });
    expect(verify.calls).toHaveLength(0);
    expect(mailer!.sent).toHaveLength(0);
    expect(await rows(env.DB)).toHaveLength(0);
  });

  it("refuses text that is not JSON", async () => {
    const { response, env } = await post("{not json");
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ ok: false, error: "invalid_body" });
    expect(await rows(env.DB)).toHaveLength(0);
  });

  it("refuses a body of another content type", async () => {
    const request = signupRequest("email=a%40b.co", { headers: { "content-type": "text/plain" } });
    const response = await handle(request, testEnv(), deps(fakeVerify(), fakeMailer()));
    expect(response.status).toBe(415);
  });

  it("refuses a body over 2 KB, declared or streamed", async () => {
    const big = JSON.stringify({ ...validBody, pad: "x".repeat(3000) });
    const streamed = await handle(signupRequest(big), testEnv(), deps(fakeVerify(), fakeMailer()));
    expect(streamed.status).toBe(413);
    const declared = await handle(
      signupRequest(validBody, { headers: { "content-type": "application/json", "content-length": "9999" } }),
      testEnv(),
      deps(fakeVerify(), fakeMailer()),
    );
    expect(declared.status).toBe(413);
  });

  it("answers other methods with 405 and an Allow header", async () => {
    const response = await handle(new Request(SIGNUP, { method: "GET" }), testEnv(), deps(fakeVerify(), fakeMailer()));
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("POST");
  });

  it("answers an unknown API path with 404 JSON", async () => {
    const response = await handle(new Request("https://emberwalk.app/api/nothing"), testEnv(), deps(fakeVerify(), fakeMailer()));
    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/json");
  });
});

describe("POST /api/signup, Turnstile refused", () => {
  it("refuses a failed check with 403 and stores nothing", async () => {
    const { response, mailer, env } = await post(validBody, { verify: fakeVerify("fail") });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, error: "turnstile_failed" });
    expect(await rows(env.DB)).toHaveLength(0);
    expect(mailer!.sent).toHaveLength(0);
  });

  it("refuses a missing token without asking Cloudflare", async () => {
    const { response, verify, env } = await post({ email: validBody.email, role: validBody.role });
    expect(response.status).toBe(403);
    expect(verify.calls).toHaveLength(0);
    expect(await rows(env.DB)).toHaveLength(0);
  });

  it("answers 503 when the check cannot be reached, and stores nothing", async () => {
    const { response, env } = await post(validBody, { verify: fakeVerify("throw") });
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, error: "turnstile_unavailable" });
    expect(await rows(env.DB)).toHaveLength(0);
  });

  it("answers 503 when the check replies with something unreadable", async () => {
    const { response, env } = await post(validBody, { verify: fakeVerify("bad-json") });
    expect(response.status).toBe(503);
    expect(await rows(env.DB)).toHaveLength(0);
  });

  it("sends the secret and token to Cloudflare, and no address or IP", async () => {
    const { verify } = await post(validBody);
    expect(verify.calls[0].url).toBe("https://challenges.cloudflare.com/turnstile/v0/siteverify");
    expect([...verify.calls[0].body.keys()].sort()).toEqual(["response", "secret"]);
    expect(verify.calls[0].body.get("response")).toBe(validBody.turnstileToken);
    expect(verify.calls[0].body.get("secret")).toBe(testEnv().TURNSTILE_SECRET);
  });

  it("fails closed when no Turnstile secret is configured", async () => {
    const { response, verify, env } = await post(validBody, { env: testEnv({ TURNSTILE_SECRET: undefined }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "not_configured" });
    expect(verify.calls).toHaveLength(0);
    expect(await rows(env.DB)).toHaveLength(0);
  });
});

describe("POST /api/signup, duplicates", () => {
  it("answers a repeat exactly like a first signup and sends no second email", async () => {
    const first = await post(validBody);
    const mailer = first.mailer!;
    const repeat = await post({ ...validBody, email: "NEIGHBOR@example.com", role: "landlord" }, { mailer });
    expect(repeat.response.status).toBe(first.response.status);
    expect(await repeat.response.json()).toEqual({ ok: true });
    expect([...repeat.response.headers].sort()).toEqual([...first.response.headers].sort());

    const stored = await rows(first.env.DB);
    expect(stored).toHaveLength(1);
    expect(stored[0].role).toBe("homeowner");
    expect(mailer.sent).toHaveLength(1);
  });

  it("still refuses a repeat whose Turnstile check fails", async () => {
    const first = await post(validBody);
    const repeat = await post(validBody, { verify: fakeVerify("fail"), mailer: first.mailer });
    expect(repeat.response.status).toBe(403);
  });
});

describe("POST /api/signup, outside services failing", () => {
  it("keeps the signup and leaves it unwelcomed when the email send fails", async () => {
    const { response, env } = await post(validBody, { mailer: fakeMailer(true) });
    expect(response.status).toBe(200);
    const stored = await rows(env.DB);
    expect(stored).toHaveLength(1);
    expect(stored[0].welcomed_at).toBeNull();
  });

  it("keeps the signup and sends nothing when no mail key is configured", async () => {
    const { response, env } = await post(validBody, { mailer: null });
    expect(response.status).toBe(200);
    const stored = await rows(env.DB);
    expect(stored).toHaveLength(1);
    expect(stored[0].welcomed_at).toBeNull();
  });

  it("keeps the signup and sends nothing when no unsubscribe signing value is configured", async () => {
    const { response, env, mailer } = await post(validBody, { env: testEnv({ UNSUBSCRIBE_SECRET: undefined }) });
    expect(response.status).toBe(200);
    expect(mailer!.sent).toHaveLength(0);
    expect((await rows(env.DB))[0].welcomed_at).toBeNull();
  });

  it("answers 500 without leaking details when storage fails", async () => {
    const broken = {
      prepare() {
        throw new Error("D1_ERROR: disk on fire");
      },
    } as unknown as D1Database;
    const { response, mailer } = await post(validBody, { env: testEnv({ DB: broken }) });
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "storage_failed" });
    expect(mailer!.sent).toHaveLength(0);
  });
});

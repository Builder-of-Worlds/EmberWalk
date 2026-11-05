import { describe, expect, it } from "vitest";
import { sendSignInMail } from "../src/sign-in-mail.ts";

const TOKEN = "T".repeat(43);
const KEY = "re_test_key_not_real";
const ORIGIN = "https://go.emberwalk.app";

type Call = { url: string; init: RequestInit };
const recorder = (answer: () => Response | Promise<Response>) => {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return answer();
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
};
const ok = () => Response.json({ id: "mail_1" }, { status: 200 });
const run = (fetchImpl: typeof fetch, over: Partial<Parameters<typeof sendSignInMail>[0]> = {}) =>
  sendSignInMail({ apiKey: KEY, appOrigin: ORIGIN, to: "manager@example.com", token: TOKEN, fetch: fetchImpl, ...over });
const bodyOf = (call: Call) => JSON.parse(call.init.body as string) as Record<string, unknown>;
const linksIn = (text: string) => text.match(/https?:\/\/\S+/g) ?? [];

describe("the sign in mail", () => {
  it("is one POST to Resend with the key as a bearer token", async () => {
    const { calls, fetchImpl } = recorder(ok);
    expect(await run(fetchImpl)).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://api.resend.com/emails");
    expect(calls[0]?.init.method).toBe("POST");
    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("goes from EmberWalk to the one address asked", async () => {
    const { calls, fetchImpl } = recorder(ok);
    await run(fetchImpl);
    const body = bodyOf(calls[0] as Call);
    expect(body.from).toBe("EmberWalk <hello@emberwalk.app>");
    expect(body.to).toEqual(["manager@example.com"]);
  });

  it("holds exactly one link and it is the hash route carrying the token", async () => {
    const { calls, fetchImpl } = recorder(ok);
    await run(fetchImpl);
    const body = bodyOf(calls[0] as Call);
    const text = String(body.text);
    expect(linksIn(text)).toEqual([`${ORIGIN}/#/sign-in/${TOKEN}`]);
    expect(body.html).toBeUndefined();
    expect(String(body.subject)).not.toContain(TOKEN);
    expect(JSON.stringify(body.headers ?? {})).not.toMatch(/https?:/);
  });

  it("builds the link the same way when the origin ends in a slash", async () => {
    const { calls, fetchImpl } = recorder(ok);
    await run(fetchImpl, { appOrigin: `${ORIGIN}/` });
    expect(linksIn(String(bodyOf(calls[0] as Call).text))).toEqual([`${ORIGIN}/#/sign-in/${TOKEN}`]);
  });
});

describe("a mail that must not go", () => {
  it("sends nothing and says not_set_up with no key", async () => {
    for (const apiKey of [undefined, ""]) {
      const { calls, fetchImpl } = recorder(ok);
      expect(await run(fetchImpl, { apiKey })).toEqual({ ok: false, code: "not_set_up" });
      expect(calls).toHaveLength(0);
    }
  });

  it("sends nothing and says not_set_up with no app origin", async () => {
    const { calls, fetchImpl } = recorder(ok);
    expect(await run(fetchImpl, { appOrigin: undefined })).toEqual({ ok: false, code: "not_set_up" });
    expect(await run(fetchImpl, { appOrigin: "not a url" })).toEqual({ ok: false, code: "not_set_up" });
    expect(await run(fetchImpl, { appOrigin: "javascript:alert(1)" })).toEqual({ ok: false, code: "not_set_up" });
    expect(calls).toHaveLength(0);
  });

  it("sends nothing over plain http except to a local dev server", async () => {
    for (const appOrigin of ["http://go.emberwalk.app", "http://example.com:8787", "http://localhost.evil.com", "http://127.0.0.2:8787"]) {
      const { calls, fetchImpl } = recorder(ok);
      expect(await run(fetchImpl, { appOrigin })).toEqual({ ok: false, code: "not_set_up" });
      expect(calls).toHaveLength(0);
    }
  });

  it("allows http for localhost and 127.0.0.1, and builds the link on that origin", async () => {
    for (const appOrigin of ["http://localhost:5173", "http://127.0.0.1:8787"]) {
      const { calls, fetchImpl } = recorder(ok);
      expect(await run(fetchImpl, { appOrigin })).toEqual({ ok: true });
      expect(linksIn(String(bodyOf(calls[0] as Call).text))).toEqual([`${appOrigin}/#/sign-in/${TOKEN}`]);
    }
  });

  it("refuses an address that is not one plain address, without calling Resend", async () => {
    for (const to of ["", "nobody", "a@b.com, c@d.com", "a@b.com\nbcc: c@d.com", "a b@c.com", "<a@b.com>"]) {
      const { calls, fetchImpl } = recorder(ok);
      expect(await run(fetchImpl, { to })).toEqual({ ok: false, code: "bad_address" });
      expect(calls).toHaveLength(0);
    }
  });

  it("refuses a token that is not 43 URL safe characters, without calling Resend", async () => {
    for (const token of ["", "short", `${TOKEN}/`, `${TOKEN.slice(1)}?`]) {
      const { calls, fetchImpl } = recorder(ok);
      expect(await run(fetchImpl, { token })).toEqual({ ok: false, code: "bad_token" });
      expect(calls).toHaveLength(0);
    }
  });
});

describe("Resend failing", () => {
  it("answers refused for a 4xx", async () => {
    for (const status of [400, 401, 403, 422, 429]) {
      const { fetchImpl } = recorder(() => Response.json({ message: "no" }, { status }));
      expect(await run(fetchImpl)).toEqual({ ok: false, code: "refused" });
    }
  });

  it("answers down for a 5xx", async () => {
    for (const status of [500, 502, 503]) {
      const { fetchImpl } = recorder(() => new Response("oops", { status }));
      expect(await run(fetchImpl)).toEqual({ ok: false, code: "down" });
    }
  });

  it("answers unreachable when the network fails, and never carries the key or the token", async () => {
    const { fetchImpl } = recorder(() => {
      throw new TypeError(`fetch failed for ${KEY} ${TOKEN}`);
    });
    const result = await run(fetchImpl);
    expect(result).toEqual({ ok: false, code: "unreachable" });
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});

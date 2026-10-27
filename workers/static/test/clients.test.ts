import { describe, expect, it } from "vitest";
import { finishEmail, welcomeMessage } from "../src/email-copy";
import { createResendMailer } from "../src/resend";
import { verifyTurnstile } from "../src/turnstile";
import { TURNSTILE_FAIL_SECRET, TURNSTILE_PASS_SECRET, fakeVerify } from "./helpers";

describe("verifyTurnstile", () => {
  it("returns ok when Cloudflare says success", async () => {
    expect(await verifyTurnstile("tok", TURNSTILE_PASS_SECRET, fakeVerify("pass").fetch)).toBe("ok");
  });

  it("returns failed when Cloudflare says no", async () => {
    expect(await verifyTurnstile("tok", TURNSTILE_FAIL_SECRET, fakeVerify("fail").fetch)).toBe("failed");
  });

  it("returns unavailable when the request throws or the reply is not JSON", async () => {
    expect(await verifyTurnstile("tok", "s", fakeVerify("throw").fetch)).toBe("unavailable");
    expect(await verifyTurnstile("tok", "s", fakeVerify("bad-json").fetch)).toBe("unavailable");
  });

  it("returns unavailable on a server error from Cloudflare", async () => {
    const serverError = (async () => Response.json({ success: true }, { status: 500 })) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "s", serverError)).toBe("unavailable");
  });

  it("treats a success value that is not exactly true as failed", async () => {
    const odd = (async () => Response.json({ success: "true" })) as unknown as typeof fetch;
    expect(await verifyTurnstile("tok", "s", odd)).toBe("failed");
  });
});

describe("createResendMailer", () => {
  const LINK = "https://emberwalk.app/unsubscribe?t=abc.def";
  const FOOTER = "EmberWalk, Deacon Roswell, 732 S 6th Street #5709, Las Vegas, NV 89101";
  const message = { to: "a@example.com", subject: "S", body: "T", unsubscribeUrl: LINK };

  function sentBody(seen: { init: RequestInit }[]) {
    return JSON.parse(String(seen[0].init.body)) as Record<string, unknown>;
  }

  function capture(status = 200) {
    const seen: { url: string; init: RequestInit }[] = [];
    const fetchFake = (async (input: RequestInfo | URL, init?: RequestInit) => {
      seen.push({ url: String(input), init: init ?? {} });
      return status === 200 ? Response.json({ id: "email_1" }) : new Response("no", { status });
    }) as unknown as typeof fetch;
    return { seen, fetchFake };
  }

  it("posts the message to Resend with the key and the EmberWalk sender", async () => {
    const { seen, fetchFake } = capture();
    await createResendMailer("re_test_key", fetchFake).send(message);
    expect(seen).toHaveLength(1);
    expect(seen[0].url).toBe("https://api.resend.com/emails");
    expect(seen[0].init.method).toBe("POST");
    const headers = new Headers(seen[0].init.headers);
    expect(headers.get("authorization")).toBe("Bearer re_test_key");
    expect(headers.get("content-type")).toBe("application/json");
    expect(sentBody(seen)).toMatchObject({
      from: "EmberWalk <hello@emberwalk.app>",
      reply_to: "hello@emberwalk.app",
      to: ["a@example.com"],
      subject: "S",
    });
  });

  it("ends every email with the postal address, after the unsubscribe link", async () => {
    const { seen, fetchFake } = capture();
    await createResendMailer("k", fetchFake).send(message);
    const text = String(sentBody(seen).text);
    expect(text.startsWith("T\n")).toBe(true);
    expect(text.endsWith(FOOTER)).toBe(true);
    expect(text.indexOf(LINK)).toBeGreaterThan(-1);
    expect(text.indexOf(LINK)).toBeLessThan(text.indexOf(FOOTER));
    expect(text).toContain("reply to this email");
  });

  it("sends the one click unsubscribe headers of RFC 8058", async () => {
    const { seen, fetchFake } = capture();
    await createResendMailer("k", fetchFake).send(message);
    expect(sentBody(seen).headers).toEqual({
      "List-Unsubscribe": `<${LINK}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
  });

  it("never turns tracking on and adds no link other than the unsubscribe link", async () => {
    const { seen, fetchFake } = capture();
    await createResendMailer("k", fetchFake).send(message);
    const body = sentBody(seen);
    expect(Object.keys(body).sort()).toEqual(["from", "headers", "reply_to", "subject", "text", "to"]);
    expect(JSON.stringify(body)).not.toMatch(/track|pixel|open_|click_/i);
    expect(String(body.text).match(/https?:\/\/\S+/g)).toEqual([LINK]);
  });

  it.each([401, 422, 500])("throws when Resend answers %i", async (status) => {
    const { fetchFake } = capture(status);
    await expect(createResendMailer("k", fetchFake).send(message)).rejects.toThrow(String(status));
  });
});

describe("welcomeMessage", () => {
  it("is addressed to the signup and names the launch date and the sender address", () => {
    const message = welcomeMessage("a@example.com", "https://emberwalk.app/unsubscribe?t=x.y");
    expect(message.to).toBe("a@example.com");
    expect(message.subject).toBe("You're on the list");
    expect(message.unsubscribeUrl).toBe("https://emberwalk.app/unsubscribe?t=x.y");
    expect(message.body).toContain("Nov. 4th, 2026");
    expect(message.body).toContain("hello@emberwalk.app");
  });

  it("is finished with the unsubscribe link and the postal address", () => {
    const text = finishEmail(welcomeMessage("a@example.com", "https://emberwalk.app/unsubscribe?t=x.y"));
    expect(text).toContain("https://emberwalk.app/unsubscribe?t=x.y");
    expect(text.endsWith("EmberWalk, Deacon Roswell, 732 S 6th Street #5709, Las Vegas, NV 89101")).toBe(true);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import { handle } from "../src/handler";
import { readToken, signToken, unsubscribeUrl } from "../src/unsubscribe";
import { TEST_SIGNING_VALUE, clearSignups, deps, fakeMailer, fakeVerify, rows, testEnv } from "./helpers";

async function visit(path: string, init: RequestInit = {}, env = testEnv()) {
  return handle(new Request(`https://emberwalk.app${path}`, init), env, deps(fakeVerify(), fakeMailer()));
}

async function linkFor(email: string, secret = TEST_SIGNING_VALUE) {
  const url = await unsubscribeUrl(email, secret);
  return new URL(url).pathname + new URL(url).search;
}

async function seed() {
  await testEnv().DB.prepare(
    "INSERT INTO signups (email, role) VALUES ('leaving@example.com', 'homeowner'), ('staying@example.com', 'landlord')",
  ).run();
}

beforeEach(async () => {
  await clearSignups(testEnv().DB);
});

describe("tokens", () => {
  it("carry the address and read back only with the same signing value", async () => {
    const token = await signToken("a@example.com", TEST_SIGNING_VALUE);
    expect(await readToken(token, TEST_SIGNING_VALUE)).toBe("a@example.com");
    expect(await readToken(token, "another-signing-value")).toBeNull();
  });

  it("give a different token to every address", async () => {
    expect(await signToken("a@example.com", TEST_SIGNING_VALUE)).not.toBe(await signToken("b@example.com", TEST_SIGNING_VALUE));
  });

  it.each(["", "abc", "a.b.c", "!!!.???", ".", "YUBleGFtcGxlLmNvbQ.", "YUBleGFtcGxlLmNvbQ.AAAA"])("refuse the malformed token %j", async (token) => {
    expect(await readToken(token, TEST_SIGNING_VALUE)).toBeNull();
  });

  it("refuse an address swapped into a genuine token", async () => {
    const [, signature] = (await signToken("a@example.com", TEST_SIGNING_VALUE)).split(".");
    const swapped = `${btoa("victim@example.com").replaceAll("=", "")}.${signature}`;
    expect(await readToken(swapped, TEST_SIGNING_VALUE)).toBeNull();
  });
});

describe("GET /unsubscribe, normal", () => {
  it("removes that person at once, shows a plain confirmation and leaves everyone else", async () => {
    await seed();
    const response = await visit(await linkFor("leaving@example.com"));
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    const page = await response.text();
    expect(page).toContain("You're unsubscribed");
    expect(page).not.toContain("leaving@example.com");
    expect((await rows(testEnv().DB)).map((row) => row.email)).toEqual(["staying@example.com"]);
  });

  it("removes a person whose address has an apostrophe", async () => {
    await testEnv().DB.prepare("INSERT INTO signups (email, role) VALUES ('o''brien@example.com', 'other')").run();
    expect((await visit(await linkFor("o'brien@example.com"))).status).toBe(200);
    expect(await rows(testEnv().DB)).toHaveLength(0);
  });
});

describe("POST /unsubscribe, one click from the mail app (RFC 8058)", () => {
  it("removes that person from the link in the header and answers 200", async () => {
    await seed();
    const response = await visit(await linkFor("leaving@example.com"), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: "List-Unsubscribe=One-Click",
    });
    expect(response.status).toBe(200);
    expect((await rows(testEnv().DB)).map((row) => row.email)).toEqual(["staying@example.com"]);
  });
});

describe("/unsubscribe, already removed", () => {
  it("answers exactly like a first removal and changes nothing", async () => {
    await seed();
    const link = await linkFor("leaving@example.com");
    const first = await visit(link);
    const second = await visit(link);
    expect(second.status).toBe(first.status);
    expect(await second.text()).toBe(await first.text());
    expect((await rows(testEnv().DB)).map((row) => row.email)).toEqual(["staying@example.com"]);
  });

  it("answers a genuine link for someone who never signed up like a removal", async () => {
    const response = await visit(await linkFor("never@example.com"));
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("You're unsubscribed");
  });
});

describe("/unsubscribe, invalid", () => {
  it.each([
    ["no token", "/unsubscribe"],
    ["an empty token", "/unsubscribe?t="],
    ["a made up token", "/unsubscribe?t=abc.def"],
    ["a token with the signature cut off", "/unsubscribe?t=bGVhdmluZ0BleGFtcGxlLmNvbQ"],
  ])("refuses %s, says so and removes nobody", async (_name, path) => {
    await seed();
    const response = await visit(path);
    expect(response.status).toBe(400);
    expect(await response.text()).toContain("That link doesn't work");
    expect(await rows(testEnv().DB)).toHaveLength(2);
  });

  it("refuses a link signed with another value and removes nobody", async () => {
    await seed();
    const response = await visit(await linkFor("leaving@example.com", "someone-elses-signing-value"));
    expect(response.status).toBe(400);
    expect(await rows(testEnv().DB)).toHaveLength(2);
  });

  it("refuses a link whose address was changed", async () => {
    await seed();
    const link = await linkFor("leaving@example.com");
    const tampered = link.replace(/t=[^.]+/, `t=${btoa("staying@example.com").replaceAll("=", "")}`);
    expect((await visit(tampered)).status).toBe(400);
    expect(await rows(testEnv().DB)).toHaveLength(2);
  });

  it.each(["PUT", "DELETE", "PATCH"])("answers %s with 405 and removes nobody", async (method) => {
    await seed();
    const response = await visit(await linkFor("leaving@example.com"), { method });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, POST");
    expect(await rows(testEnv().DB)).toHaveLength(2);
  });
});

describe("/unsubscribe, failing", () => {
  it("fails closed and removes nobody when no signing value is configured", async () => {
    await seed();
    const response = await visit(await linkFor("leaving@example.com"), {}, testEnv({ UNSUBSCRIBE_SECRET: undefined }));
    expect(response.status).toBe(500);
    expect(await response.text()).toContain("Something went wrong");
    expect(await rows(testEnv().DB)).toHaveLength(2);
  });

  it("says something went wrong, without details, when storage fails", async () => {
    const broken = {
      prepare() {
        throw new Error("D1_ERROR: disk on fire");
      },
    } as unknown as D1Database;
    const response = await visit(await linkFor("leaving@example.com"), {}, testEnv({ DB: broken }));
    expect(response.status).toBe(500);
    const page = await response.text();
    expect(page).toContain("Something went wrong");
    expect(page).not.toContain("disk on fire");
  });
});

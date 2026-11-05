import { describe, expect, it } from "vitest";
import { checkSignInToken, constantTimeEqual, hashToken, linkExpiry, LINK_MINUTES, newSignInToken } from "../src/sign-in-token.ts";

const NOW = new Date("2026-10-31T12:00:00.000Z");
const minutes = (n: number) => new Date(NOW.getTime() + n * 60_000);

describe("a sign in token", () => {
  it("is 43 URL safe characters and never repeats", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const { token } = await newSignInToken();
      expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
      seen.add(token);
    }
    expect(seen.size).toBe(50);
  });

  it("hands back only a SHA-256 hash to store, never the token", async () => {
    const { token, hash } = await newSignInToken();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(token);
    expect(hash).toBe(await hashToken(token));
  });

  it("hashes with SHA-256 (known answer for abc)", async () => {
    expect(await hashToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("expires 15 minutes after it is made", () => {
    expect(LINK_MINUTES).toBe(15);
    expect(linkExpiry(NOW)).toBe("2026-10-31T12:15:00.000Z");
  });
});

describe("checking a token against its stored hash", () => {
  it("passes the right token before it expires", async () => {
    const { token, hash } = await newSignInToken();
    expect(await checkSignInToken(token, { hash, expiresAt: linkExpiry(NOW) }, minutes(14))).toBe("ok");
  });

  it("refuses an expired token, at the expiry second and after", async () => {
    const { token, hash } = await newSignInToken();
    const stored = { hash, expiresAt: linkExpiry(NOW) };
    expect(await checkSignInToken(token, stored, minutes(15))).toBe("expired");
    expect(await checkSignInToken(token, stored, minutes(600))).toBe("expired");
  });

  it("is good at 14:59.999 and expired at exactly 15:00.000", async () => {
    const { token, hash } = await newSignInToken();
    const stored = { hash, expiresAt: linkExpiry(NOW) };
    expect(await checkSignInToken(token, stored, new Date(NOW.getTime() + 15 * 60_000 - 1))).toBe("ok");
    expect(await checkSignInToken(token, stored, new Date(NOW.getTime() + 15 * 60_000))).toBe("expired");
  });

  it("refuses an altered token", async () => {
    const { token, hash } = await newSignInToken();
    const flipped = (token.startsWith("A") ? "B" : "A") + token.slice(1);
    expect(await checkSignInToken(flipped, { hash, expiresAt: linkExpiry(NOW) }, NOW)).toBe("altered");
  });

  it("refuses a token that is not 43 URL safe characters without hashing it", async () => {
    const { token, hash } = await newSignInToken();
    const stored = { hash, expiresAt: linkExpiry(NOW) };
    for (const bad of ["", "short", `${token}x`, token.slice(1), `${token.slice(1)}+`, `${token.slice(1)} `]) {
      expect(await checkSignInToken(bad, stored, NOW)).toBe("malformed");
    }
  });

  it("treats an unreadable expiry as expired", async () => {
    const { token, hash } = await newSignInToken();
    expect(await checkSignInToken(token, { hash, expiresAt: "soon" }, NOW)).toBe("expired");
  });

  it("refuses a stored hash of the wrong length", async () => {
    const { token } = await newSignInToken();
    expect(await checkSignInToken(token, { hash: "abcd", expiresAt: linkExpiry(NOW) }, NOW)).toBe("altered");
  });
});

describe("constant time compare", () => {
  it("is true only for identical strings of the same length", () => {
    expect(constantTimeEqual("abcdef", "abcdef")).toBe(true);
    expect(constantTimeEqual("abcdef", "abcdeg")).toBe(false);
    expect(constantTimeEqual("gbcdef", "abcdef")).toBe(false);
    expect(constantTimeEqual("abc", "abcdef")).toBe(false);
    expect(constantTimeEqual("", "")).toBe(true);
    expect(constantTimeEqual("", "a")).toBe(false);
  });

  it("reads every character, wherever the first difference is", () => {
    const reads: number[] = [];
    const watch = (s: string): string =>
      new Proxy(new String(s), {
        get(target, prop, receiver) {
          if (prop === "charCodeAt") return (i: number) => (reads.push(i), s.charCodeAt(i));
          const value = Reflect.get(target, prop, receiver) as unknown;
          return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(s) : value;
        },
      }) as unknown as string;
    expect(constantTimeEqual(watch("xbcdef"), "abcdef")).toBe(false);
    expect(reads.sort()).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

import { describe, expect, it } from "vitest";
import { clearingCookie, readSessionToken, SESSION_COOKIE, SESSION_DAYS, sessionCookie, sessionExpiry, newSessionToken } from "../src/session-cookie.ts";

const TOKEN = "A".repeat(43);
const OTHER = "B".repeat(43);

describe("the session cookie", () => {
  it("carries HttpOnly, Secure, SameSite=Lax, Path=/api and a year", () => {
    const parts = sessionCookie(TOKEN).split("; ");
    expect(parts[0]).toBe(`${SESSION_COOKIE}=${TOKEN}`);
    expect(parts).toContain("HttpOnly");
    expect(parts).toContain("Secure");
    expect(parts).toContain("SameSite=Lax");
    expect(parts).toContain("Path=/api");
    expect(SESSION_DAYS).toBe(365);
    expect(parts).toContain(`Max-Age=${365 * 24 * 60 * 60}`);
  });

  it("sets no Domain, so it stays on the one host", () => {
    expect(sessionCookie(TOKEN)).not.toMatch(/domain/i);
  });

  it("refuses to wrap a token that is not 43 URL safe characters", () => {
    for (const bad of ["", "short", `${TOKEN}x`, `${TOKEN.slice(1)};`, `${TOKEN.slice(1)}\n`]) {
      expect(() => sessionCookie(bad)).toThrow();
    }
  });

  it("expires a year after it is made", () => {
    expect(sessionExpiry(new Date("2026-10-31T12:00:00.000Z"))).toBe("2027-10-31T12:00:00.000Z");
  });

  it("makes a session token like a sign in token, with a hash to store", async () => {
    const { token, hash } = await newSessionToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("clearing the cookie for sign out", () => {
  it("empties the value and ends it now, with the same attributes so the browser matches it", () => {
    const parts = clearingCookie().split("; ");
    expect(parts[0]).toBe(`${SESSION_COOKIE}=`);
    expect(parts).toContain("Max-Age=0");
    for (const kept of ["HttpOnly", "Secure", "SameSite=Lax", "Path=/api"]) expect(parts).toContain(kept);
  });
});

describe("reading the session token from a Cookie header", () => {
  it("reads the token", () => {
    expect(readSessionToken(`${SESSION_COOKIE}=${TOKEN}`)).toBe(TOKEN);
  });

  it("ignores every other cookie", () => {
    expect(readSessionToken(`theme=dark; ${SESSION_COOKIE}=${TOKEN}; a=b`)).toBe(TOKEN);
    expect(readSessionToken(`theme=dark; a=${TOKEN}`)).toBeNull();
    expect(readSessionToken(`x${SESSION_COOKIE}=${TOKEN}`)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}x=${TOKEN}`)).toBeNull();
  });

  it("reads no header, an empty header and an empty value as signed out", () => {
    expect(readSessionToken(null)).toBeNull();
    expect(readSessionToken("")).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=`)).toBeNull();
  });

  it("refuses a malformed value", () => {
    for (const bad of ["short", `${TOKEN}x`, TOKEN.slice(1), `${TOKEN.slice(1)}+`, `"${TOKEN}"`, `${TOKEN.slice(1)}%`]) {
      expect(readSessionToken(`${SESSION_COOKIE}=${bad}`)).toBeNull();
    }
  });

  it("refuses a doubled cookie, even when both are well formed and the same", () => {
    expect(readSessionToken(`${SESSION_COOKIE}=${TOKEN}; ${SESSION_COOKIE}=${OTHER}`)).toBeNull();
    expect(readSessionToken(`${SESSION_COOKIE}=${TOKEN}; ${SESSION_COOKIE}=${TOKEN}`)).toBeNull();
  });

  it("refuses a doubled cookie when one copy is malformed", () => {
    expect(readSessionToken(`${SESSION_COOKIE}=bad; ${SESSION_COOKIE}=${TOKEN}`)).toBeNull();
  });
});

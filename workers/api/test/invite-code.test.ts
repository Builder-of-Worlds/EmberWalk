import { Invite } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { hashInviteCode, isInviteCode, newInviteCode } from "../src/invite-code.ts";

const invite = (code: string) => ({
  id: "00000000-0000-4000-8000-000000000042",
  propertyId: "00000000-0000-4000-8000-000000000041",
  code,
  createdAt: "2026-10-31T12:00:00.000Z",
  expiresAt: "2026-11-07T12:00:00.000Z",
  usedAt: null,
  walkId: null,
});

describe("an invite code", () => {
  it("passes the Invite contract's code rule and is 32 URL safe characters", async () => {
    const { code } = await newInviteCode();
    expect(code).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(Invite.safeParse(invite(code)).success).toBe(true);
    expect(Invite.safeParse(invite("not+a/code")).success).toBe(false);
  });

  it("never repeats", async () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) seen.add((await newInviteCode()).code);
    expect(seen.size).toBe(50);
  });

  it("hands back a SHA-256 hash to store that does not hold the code", async () => {
    const { code, hash } = await newInviteCode();
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(code);
    expect(hash).toBe(await hashInviteCode(code));
  });

  it("hashes the same code the same way and different codes differently", async () => {
    const a = await newInviteCode();
    const b = await newInviteCode();
    expect(await hashInviteCode(a.code)).toBe(a.hash);
    expect(a.hash).not.toBe(b.hash);
  });
});

describe("telling a code from anything else", () => {
  it("accepts a generated code", async () => {
    expect(isInviteCode((await newInviteCode()).code)).toBe(true);
  });

  it("agrees with the shared Invite contract at the length edges 21, 22, 64 and 65", () => {
    for (const length of [21, 22, 64, 65]) {
      const code = "a".repeat(length);
      expect(isInviteCode(code)).toBe(Invite.safeParse(invite(code)).success);
    }
    expect([21, 22, 64, 65].map((n) => isInviteCode("a".repeat(n)))).toEqual([false, true, true, false]);
  });

  it("agrees with the shared Invite contract on characters at the edges of the set", () => {
    for (const char of ["A", "z", "0", "9", "-", "_", "+", "/", "=", ".", " "]) {
      const code = char.repeat(22);
      expect(isInviteCode(code)).toBe(Invite.safeParse(invite(code)).success);
    }
  });

  it("refuses text the contract would refuse", () => {
    for (const bad of ["", "short", "a".repeat(21), "a".repeat(65), `${"a".repeat(31)}+`, `${"a".repeat(31)} `, `${"a".repeat(31)}/`]) {
      expect(isInviteCode(bad)).toBe(false);
    }
  });

  it("refuses to hash a malformed code", async () => {
    await expect(hashInviteCode("nope")).rejects.toThrow();
  });
});

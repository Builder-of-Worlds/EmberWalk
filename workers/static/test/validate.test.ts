import { describe, expect, it } from "vitest";
import { validateSignup } from "../src/validate";

const good = { email: "Neighbor@Example.com ", role: "homeowner", turnstileToken: "tok" };

describe("validateSignup", () => {
  it("accepts each role and normalizes the email", () => {
    for (const role of ["homeowner", "landlord", "other"]) {
      expect(validateSignup({ ...good, role })).toEqual({
        ok: true,
        email: "neighbor@example.com",
        role,
        token: "tok",
      });
    }
  });

  it("accepts an address of exactly 254 characters and a local part of exactly 64", () => {
    expect(validateSignup({ ...good, email: `a@${"b".repeat(248)}.com` })).toMatchObject({ ok: true });
    expect(validateSignup({ ...good, email: `${"a".repeat(64)}@example.com` })).toMatchObject({ ok: true });
  });

  it("accepts an apostrophe and a plus tag in the local part", () => {
    const result = validateSignup({ ...good, email: "o'brien+fire@example.org" });
    expect(result).toMatchObject({ ok: true, email: "o'brien+fire@example.org" });
  });

  it.each([
    ["empty", ""],
    ["blank", "   "],
    ["no at sign", "neighbor.example.com"],
    ["two at signs", "a@b@example.com"],
    ["no local part", "@example.com"],
    ["no domain", "neighbor@"],
    ["no dot in domain", "neighbor@localhost"],
    ["space inside", "neigh bor@example.com"],
    ["domain starts with a dot", "neighbor@.example.com"],
    ["domain ends with a dot", "neighbor@example.com."],
    ["double dot", "neighbor@example..com"],
    ["angle brackets", "<neighbor@example.com>"],
    ["local part over 64", `${"a".repeat(65)}@example.com`],
    ["address of 255 characters", `a@${"b".repeat(249)}.com`],
    ["double dot in the local part", "a..b@example.com"],
    ["line break", "neighbor@example.com\nbcc:x@example.com"],
  ])("refuses an email that is %s", (_name, email) => {
    expect(validateSignup({ ...good, email })).toEqual({ ok: false, error: "invalid_email" });
  });

  it.each([
    ["missing", undefined],
    ["empty", ""],
    ["unknown", "admin"],
    ["wrong case", "Homeowner"],
    ["a number", 3],
    ["an object", { a: 1 }],
  ])("refuses a role that is %s", (_name, role) => {
    expect(validateSignup({ ...good, role })).toEqual({ ok: false, error: "invalid_role" });
  });

  it.each([null, undefined, "text", 7, []])("refuses a body that is %j", (body) => {
    expect(validateSignup(body)).toEqual({ ok: false, error: "invalid_body" });
  });

  it("refuses an email that is not text", () => {
    expect(validateSignup({ ...good, email: 5 })).toEqual({ ok: false, error: "invalid_email" });
  });

  it("returns an empty token when none was sent", () => {
    const rest = Object.fromEntries(Object.entries(good).filter(([key]) => key !== "turnstileToken"));
    expect(validateSignup(rest)).toMatchObject({ ok: true, token: "" });
  });
});

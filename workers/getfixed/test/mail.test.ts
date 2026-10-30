import { describe, expect, it } from "vitest";
import { base64Of, draft, MailOff, mailConfig, mailText, messageOfToken, OPTOUT_LINE, optoutToken, tokenOfMailbox } from "../src/mail.ts";
import { FOOTER, MAIL_ENV, uuid } from "./harness.ts";

const BASE = { JOB_MAIL_DOMAIN: "emberwalk.app", APP_ORIGIN: "https://go.emberwalk.app" };

describe("mail setup", () => {
  it("fails closed when the key, the footer or the opt-out secret is missing", () => {
    expect(mailConfig({ ...BASE, ...MAIL_ENV })).toMatchObject({ footer: FOOTER, domain: "emberwalk.app" });
    expect(() => mailConfig({ ...BASE, ...MAIL_ENV, MAIL_FOOTER: " " })).toThrow(MailOff);
    expect(() => mailConfig({ ...BASE, MAIL_FOOTER: MAIL_ENV.MAIL_FOOTER, OPTOUT_SECRET: MAIL_ENV.OPTOUT_SECRET })).toThrow("RESEND_API_KEY missing");
    expect(() => mailConfig({ ...BASE, MAIL_FOOTER: FOOTER })).toThrow("RESEND_API_KEY, OPTOUT_SECRET missing");
  });

  it("ends every email with the opt-out line, its link and the footer", () => {
    expect(mailText("Hello", "https://x/y", FOOTER)).toBe(`Hello\n\n${OPTOUT_LINE} https://x/y\n\n${FOOTER}`);
    expect(mailText("Hello", "https://x/y", FOOTER)).toBe(`Hello\n\nTo be taken off the list, use this link, or reply to this email and say so: https://x/y\n\n${FOOTER}`);
    expect(draft.optoutLine).toBe(OPTOUT_LINE);
  });
});

describe("opt-out links", () => {
  const id = uuid("da000000", 1);

  it("signs a message id and reads it back only with the same secret", async () => {
    const token = await optoutToken("secret-one", id);
    expect(await messageOfToken("secret-one", token)).toBe(id);
    expect(await messageOfToken("secret-two", token)).toBeNull();
  });

  it("refuses a changed id, a changed signature or a malformed token", async () => {
    const token = await optoutToken("secret-one", id);
    const [, sig = ""] = token.split(".");
    expect(await messageOfToken("secret-one", `${uuid("da000000", 2)}.${sig}`)).toBeNull();
    expect(await messageOfToken("secret-one", `${id}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`)).toBeNull();
    expect(await messageOfToken("secret-one", id)).toBeNull();
  });
});

describe("job mailboxes", () => {
  it("reads the job token from the plus address on our domain only", () => {
    expect(tokenOfMailbox("Jobs+K3Y4J0B5T0K3N123@EmberWalk.app", "emberwalk.app")).toBe("k3y4j0b5t0k3n123");
    expect(tokenOfMailbox("jobs+k3y4j0b5t0k3n123@other.app", "emberwalk.app")).toBeNull();
    expect(tokenOfMailbox("jobs+short@emberwalk.app", "emberwalk.app")).toBeNull();
    expect(tokenOfMailbox("owner@emberwalk.app", "emberwalk.app")).toBeNull();
  });

  it("encodes attachments as base64, including large ones", () => {
    expect(base64Of(new Uint8Array([0xff, 0xd8, 0x00]))).toBe("/9gA");
    const big = new Uint8Array(100_000).fill(65);
    expect(atob(base64Of(big))).toBe("A".repeat(100_000));
  });
});

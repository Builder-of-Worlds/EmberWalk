import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  countLinks,
  createLink,
  endSession,
  findOrCreateAccount,
  sessionAccount,
  startSession,
  useLink,
  visitorsOfAccount,
} from "../src/accounts.ts";
import { DbRefused } from "../src/errors.ts";
import { resetDb, VISITOR } from "./fixtures.ts";

const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const H3 = "3".repeat(64);
const PHONE_B = "b".repeat(64);
const PHONE_C = "d".repeat(64);
const ACCOUNT = "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER_ACCOUNT = "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const AT = "2026-10-31T10:00:00.000Z";
const SOON = "2026-10-31T10:15:00.000Z";
const LATER = "2026-10-31T10:20:00.000Z";
const MONTH = "2026-11-30T10:00:00.000Z";
const EMAIL = "manager@example.com";

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args).run();

const insertAccount = (id: string, email: string) => sql("INSERT INTO accounts (id, email, created_at) VALUES (?, ?, ?)", id, email, AT);

const insertLink = (hash: string, email: string, visitor: string, created: string, expires: string) =>
  sql("INSERT INTO sign_in_links (token_hash, email, visitor_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", hash, email, visitor, created, expires);

const insertSession = (hash: string, account: string, visitor: string, created: string, expires: string) =>
  sql("INSERT INTO sessions (token_hash, account_id, visitor_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", hash, account, visitor, created, expires);

const link = (over: Partial<Parameters<typeof createLink>[1]> = {}) => ({ tokenHash: H1, email: EMAIL, visitorId: VISITOR, createdAt: AT, expiresAt: SOON, ...over });

beforeEach(async () => {
  await sql("DELETE FROM sign_in_links");
  await sql("DELETE FROM accounts");
  await sql("DELETE FROM plans");
  await resetDb();
});

describe("the accounts table", () => {
  it("takes a plain lower case email", async () => {
    for (const [n, email] of ["a@b.co", "first.last+tag@sub.example.com", "o'brien@example.org"].entries()) {
      await insertAccount(`ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a1${n}`, email);
    }
    expect((await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>())?.n).toBe(3);
  });

  it("refuses a malformed or upper case email, one over 254 characters, and a second account for one email", async () => {
    const bad = ["", "manager", "manager@", "@example.com", "manager@example", "a@b@c.co", "Manager@example.com", "man ager@example.com", "manager@example.com ", "manager@.com", "manager@example.", `${"a".repeat(250)}@b.co`, "tab\t@example.com"];
    for (const email of bad) await expect(insertAccount(ACCOUNT, email), JSON.stringify(email)).rejects.toThrow();
    await insertAccount(ACCOUNT, EMAIL);
    await expect(insertAccount(OTHER_ACCOUNT, EMAIL)).rejects.toThrow();
    expect((await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>())?.n).toBe(1);
  });

  it("accepts an email of exactly 254 characters", async () => {
    await insertAccount(ACCOUNT, `${"a".repeat(243)}@example.co`);
    await expect(insertAccount(OTHER_ACCOUNT, `${"a".repeat(244)}@example.co`)).rejects.toThrow();
  });
});

describe("the sign in links and sessions tables", () => {
  it("refuses a link whose hash is not 64 lower case hex, whose email is bad, or that expires before it is made", async () => {
    await expect(insertLink("1".repeat(63), EMAIL, VISITOR, AT, SOON)).rejects.toThrow();
    await expect(insertLink("G".repeat(64), EMAIL, VISITOR, AT, SOON)).rejects.toThrow();
    await expect(insertLink("A".repeat(64), EMAIL, VISITOR, AT, SOON)).rejects.toThrow();
    await expect(insertLink(H1, "Manager@example.com", VISITOR, AT, SOON)).rejects.toThrow();
    await expect(insertLink(H1, EMAIL, "short", AT, SOON)).rejects.toThrow();
    await expect(insertLink(H1, EMAIL, VISITOR, AT, AT)).rejects.toThrow();
    await expect(insertLink(H1, EMAIL, VISITOR, SOON, AT)).rejects.toThrow();
    await expect(insertLink(H1, EMAIL, VISITOR, AT, "2026-10-31T10:00:00.5Z")).resolves.toBeDefined();
  });

  it("refuses a second use of one link, however it is written", async () => {
    await insertLink(H1, EMAIL, VISITOR, AT, SOON);
    await sql("UPDATE sign_in_links SET used_at = ? WHERE token_hash = ?", AT, H1);
    await expect(sql("UPDATE sign_in_links SET used_at = ? WHERE token_hash = ?", SOON, H1)).rejects.toThrow("a sign in link is used once");
    await expect(sql("UPDATE sign_in_links SET used_at = NULL WHERE token_hash = ?", H1)).rejects.toThrow("a sign in link is used once");
  });

  it("refuses a session for no account, a malformed hash, or one that expires before it starts", async () => {
    await expect(insertSession(H1, ACCOUNT, VISITOR, AT, MONTH)).rejects.toThrow();
    await insertAccount(ACCOUNT, EMAIL);
    await expect(insertSession("zz", ACCOUNT, VISITOR, AT, MONTH)).rejects.toThrow();
    await expect(insertSession(H1, ACCOUNT, VISITOR, MONTH, AT)).rejects.toThrow();
    await expect(insertSession(H1, ACCOUNT, VISITOR, AT, MONTH)).resolves.toBeDefined();
  });

  it("removes an account's sessions with it", async () => {
    await insertAccount(ACCOUNT, EMAIL);
    await insertSession(H1, ACCOUNT, VISITOR, AT, MONTH);
    await sql("DELETE FROM accounts WHERE id = ?", ACCOUNT);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM sessions").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("a sign in link", () => {
  it("is used once and gives back the email and the asking visitor", async () => {
    await createLink(env.DB, link());
    expect(await useLink(env.DB, H1, AT)).toEqual({ ok: true, email: EMAIL, visitorId: VISITOR });
    expect(await useLink(env.DB, H1, AT)).toEqual({ ok: false, reason: "used" });
  });

  it("is refused when unknown, expired or malformed, and an expired one stays unused", async () => {
    await createLink(env.DB, link());
    expect(await useLink(env.DB, H2, AT)).toEqual({ ok: false, reason: "unknown" });
    expect(await useLink(env.DB, "not a hash", AT)).toEqual({ ok: false, reason: "unknown" });
    expect(await useLink(env.DB, H1, LATER)).toEqual({ ok: false, reason: "expired" });
    expect(await useLink(env.DB, H1, SOON)).toEqual({ ok: false, reason: "expired" });
    expect(await useLink(env.DB, H1, "2026-10-31T10:14:59.999Z")).toMatchObject({ ok: true });
  });

  it("is used by one of two requests that arrive together", async () => {
    await createLink(env.DB, link());
    const answers = await Promise.all([useLink(env.DB, H1, AT), useLink(env.DB, H1, AT)]);
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect(answers.filter((a) => !a.ok)).toEqual([{ ok: false, reason: "used" }]);
  });

  it("lower cases the email, refuses a bad one and refuses a hash written twice", async () => {
    await createLink(env.DB, link({ email: "  Manager@Example.COM " }));
    expect(await useLink(env.DB, H1, AT)).toMatchObject({ email: EMAIL });
    await expect(createLink(env.DB, link({ tokenHash: H2, email: "nobody" }))).rejects.toThrow();
    await expect(createLink(env.DB, link())).rejects.toBeInstanceOf(DbRefused);
  });

  it("is counted per email or per visitor since a time, for the hourly limits", async () => {
    await createLink(env.DB, link({ tokenHash: H1, createdAt: "2026-10-31T09:00:00.000Z", expiresAt: "2026-10-31T09:15:00.000Z" }));
    await createLink(env.DB, link({ tokenHash: H2 }));
    await createLink(env.DB, link({ tokenHash: H3, email: "other@example.com", visitorId: PHONE_B }));
    const since = "2026-10-31T09:30:00.000Z";
    expect(await countLinks(env.DB, { email: EMAIL }, since)).toBe(1);
    expect(await countLinks(env.DB, { email: "MANAGER@example.com" }, "2026-10-31T08:00:00.000Z")).toBe(2);
    expect(await countLinks(env.DB, { visitorId: VISITOR }, since)).toBe(1);
    expect(await countLinks(env.DB, { visitorId: PHONE_B }, since)).toBe(1);
    expect(await countLinks(env.DB, { email: "nobody@example.com" }, since)).toBe(0);
  });
});

describe("an account", () => {
  it("is made on first use and found again by its email, in any case, with its first id", async () => {
    const first = await findOrCreateAccount(env.DB, { id: ACCOUNT, email: "Manager@Example.com", at: AT });
    expect(first).toEqual({ id: ACCOUNT, email: EMAIL, createdAt: AT });
    expect(await findOrCreateAccount(env.DB, { id: OTHER_ACCOUNT, email: EMAIL, at: LATER })).toEqual(first);
    expect((await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>())?.n).toBe(1);
  });

  it("is refused for a malformed email, leaving nothing behind", async () => {
    await expect(findOrCreateAccount(env.DB, { id: ACCOUNT, email: "manager", at: AT })).rejects.toThrow();
    expect((await env.DB.prepare("SELECT count(*) AS n FROM accounts").first<{ n: number }>())?.n).toBe(0);
  });
});

describe("a session", () => {
  beforeEach(async () => {
    await findOrCreateAccount(env.DB, { id: ACCOUNT, email: EMAIL, at: AT });
    await findOrCreateAccount(env.DB, { id: OTHER_ACCOUNT, email: "other@example.com", at: AT });
  });

  it("names its account until it expires or ends", async () => {
    await startSession(env.DB, { tokenHash: H1, accountId: ACCOUNT, visitorId: VISITOR, createdAt: AT, expiresAt: MONTH });
    expect(await sessionAccount(env.DB, H1, LATER)).toEqual({ account: { id: ACCOUNT, email: EMAIL, createdAt: AT }, visitorId: VISITOR });
    expect(await sessionAccount(env.DB, H2, LATER)).toBeNull();
    expect(await sessionAccount(env.DB, "not a hash", LATER)).toBeNull();
    expect(await sessionAccount(env.DB, H1, MONTH)).toBeNull();
    expect(await endSession(env.DB, H1, LATER)).toBe(true);
    expect(await sessionAccount(env.DB, H1, LATER)).toBeNull();
  });

  it("ends once: a second end, or an unknown session, changes nothing", async () => {
    await startSession(env.DB, { tokenHash: H1, accountId: ACCOUNT, visitorId: VISITOR, createdAt: AT, expiresAt: MONTH });
    expect(await endSession(env.DB, H1, LATER)).toBe(true);
    expect(await endSession(env.DB, H1, MONTH)).toBe(false);
    expect(await endSession(env.DB, H2, LATER)).toBe(false);
    expect((await env.DB.prepare("SELECT ended_at FROM sessions WHERE token_hash = ?").bind(H1).first<{ ended_at: string }>())?.ended_at).toBe(LATER);
  });

  it("is refused for an account that does not exist", async () => {
    await expect(startSession(env.DB, { tokenHash: H1, accountId: "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99", visitorId: VISITOR, createdAt: AT, expiresAt: MONTH })).rejects.toBeInstanceOf(DbRefused);
  });

  it("ties the account to every phone it has signed in on, ended or not, so a plan bought on one phone is found from the other", async () => {
    await startSession(env.DB, { tokenHash: H1, accountId: ACCOUNT, visitorId: VISITOR, createdAt: AT, expiresAt: MONTH });
    await startSession(env.DB, { tokenHash: H2, accountId: ACCOUNT, visitorId: PHONE_B, createdAt: AT, expiresAt: MONTH });
    await startSession(env.DB, { tokenHash: H3, accountId: ACCOUNT, visitorId: PHONE_B, createdAt: LATER, expiresAt: MONTH });
    await startSession(env.DB, { tokenHash: "5".repeat(64), accountId: ACCOUNT, visitorId: PHONE_C, createdAt: AT, expiresAt: MONTH });
    await endSession(env.DB, H2, LATER);
    await endSession(env.DB, "5".repeat(64), LATER);
    await startSession(env.DB, { tokenHash: "4".repeat(64), accountId: OTHER_ACCOUNT, visitorId: "c".repeat(64), createdAt: AT, expiresAt: MONTH });
    expect(await visitorsOfAccount(env.DB, ACCOUNT)).toEqual([VISITOR, PHONE_B, PHONE_C].sort());
    expect(await visitorsOfAccount(env.DB, OTHER_ACCOUNT)).toEqual(["c".repeat(64)]);
    expect(await visitorsOfAccount(env.DB, "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99")).toEqual([]);

    await sql("INSERT INTO plans (customer_id, visitor_id, status, event_at) VALUES ('cus_phoneA', ?, 'active', 1), ('cus_other', ?, 'active', 1)", VISITOR, "c".repeat(64));
    const found = await env.DB.prepare("SELECT customer_id FROM plans WHERE visitor_id IN (SELECT value FROM json_each(?)) ORDER BY customer_id")
      .bind(JSON.stringify(await visitorsOfAccount(env.DB, ACCOUNT)))
      .all<{ customer_id: string }>();
    expect(found.results.map((r) => r.customer_id)).toEqual(["cus_phoneA"]);
  });
});

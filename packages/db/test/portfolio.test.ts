import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { findOrCreateAccount } from "../src/accounts.ts";
import { saveClip } from "../src/clips.ts";
import { DbRefused } from "../src/errors.ts";
import { saveFindings } from "../src/findings.ts";
import { markFinding } from "../src/get-it-fixed.ts";
import {
  accountOfWalk,
  addProperty,
  createInvite,
  ensurePortfolio,
  getProperty,
  inviteByHash,
  linkWalk,
  portfolioOf,
  propertiesOf,
  propertyWalks,
  removeProperty,
  renameProperty,
  useInvite,
} from "../src/portfolio.ts";
import { clip, finding, FINDING, FINDING_2, OTHER_WALK, resetDb, seedWalk, WALK } from "./fixtures.ts";

const THIRD = "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a03";
const ACCOUNT = "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER_ACCOUNT = "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const PORTFOLIO = "bc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const OTHER_PORTFOLIO = "bc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const PROP = "cc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01";
const PROP_2 = "cc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02";
const THEIR_PROP = "cc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a03";
const invite = (n: number) => `dc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const markId = (n: number) => `0b0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a0${n}`;
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);
const AT = "2026-10-31T10:00:00.000Z";
const LATER = "2026-10-31T11:00:00.000Z";
const WEEK = "2026-11-07T10:00:00.000Z";
const DAY_AFTER = "2026-11-08T10:00:00.000Z";

const sql = (query: string, ...args: unknown[]) => env.DB.prepare(query).bind(...args).run();
const count = async (table: string) => (await env.DB.prepare(`SELECT count(*) AS n FROM ${table}`).first<{ n: number }>())?.n;

const newInvite = (n: number, over: Partial<Parameters<typeof createInvite>[1]> = {}) => ({ id: invite(n), propertyId: PROP, codeHash: H1, createdAt: AT, expiresAt: WEEK, ...over });

beforeEach(async () => {
  await sql("DELETE FROM accounts");
  await resetDb();
  await seedWalk(WALK, "done");
  await seedWalk(OTHER_WALK, "done");
  await seedWalk(THIRD, "done");
  await saveClip(env.DB, clip());
  await saveFindings(env.DB, [finding(), finding({ id: FINDING_2, rank: 2, concept: "shrub", label: "recommended" })]);
  await findOrCreateAccount(env.DB, { id: ACCOUNT, email: "manager@example.com", at: AT });
  await findOrCreateAccount(env.DB, { id: OTHER_ACCOUNT, email: "other@example.com", at: AT });
  await ensurePortfolio(env.DB, { id: PORTFOLIO, accountId: ACCOUNT, at: AT });
  await ensurePortfolio(env.DB, { id: OTHER_PORTFOLIO, accountId: OTHER_ACCOUNT, at: AT });
  await addProperty(env.DB, { id: PROP, portfolioId: PORTFOLIO, label: "Unit A", synthetic: false, at: AT });
  await addProperty(env.DB, { id: THEIR_PROP, portfolioId: OTHER_PORTFOLIO, label: "Elm Court", synthetic: false, at: AT });
});

describe("a portfolio", () => {
  it("is one per account: made once, found again, and a second row is refused by the table", async () => {
    expect(await ensurePortfolio(env.DB, { id: "bc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a09", accountId: ACCOUNT, at: LATER })).toEqual({ id: PORTFOLIO, accountId: ACCOUNT, createdAt: AT });
    expect(await portfolioOf(env.DB, ACCOUNT)).toEqual({ id: PORTFOLIO, accountId: ACCOUNT, createdAt: AT });
    await expect(sql("INSERT INTO portfolios (id, account_id, created_at) VALUES (?, ?, ?)", "bc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a09", ACCOUNT, AT)).rejects.toThrow();
    expect(await count("portfolios")).toBe(2);
  });

  it("is not made for an account that does not exist, and is none to find for one without", async () => {
    await expect(ensurePortfolio(env.DB, { id: "bc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a09", accountId: "ac0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99", at: AT })).rejects.toBeInstanceOf(DbRefused);
    await sql("DELETE FROM portfolios WHERE id = ?", OTHER_PORTFOLIO);
    expect(await portfolioOf(env.DB, OTHER_ACCOUNT)).toBeNull();
  });
});

describe("a property", () => {
  it("holds a label and a sample flag, and nothing about an address or a tenant", async () => {
    expect(await getProperty(env.DB, PROP)).toEqual({ id: PROP, portfolioId: PORTFOLIO, label: "Unit A", synthetic: false, createdAt: AT, removedAt: null });
    const columns = (await env.DB.prepare("SELECT name FROM pragma_table_info('properties')").all<{ name: string }>()).results.map((c) => c.name);
    expect(columns.sort()).toEqual(["created_at", "id", "label", "portfolio_id", "removed_at", "synthetic"]);
  });

  it("takes a label of 120 characters and refuses 121, an empty one and one with edge spaces", async () => {
    await addProperty(env.DB, { id: PROP_2, portfolioId: PORTFOLIO, label: "x".repeat(120), synthetic: true, at: AT });
    await expect(addProperty(env.DB, { id: invite(1), portfolioId: PORTFOLIO, label: "x".repeat(121), synthetic: false, at: AT })).rejects.toThrow();
    await expect(addProperty(env.DB, { id: invite(1), portfolioId: PORTFOLIO, label: "   ", synthetic: false, at: AT })).rejects.toThrow();
    await expect(sql("INSERT INTO properties (id, portfolio_id, label, created_at) VALUES (?, ?, ?, ?)", invite(1), PORTFOLIO, " padded", AT)).rejects.toThrow();
    await expect(sql("INSERT INTO properties (id, portfolio_id, label, created_at) VALUES (?, ?, ?, ?)", invite(1), PORTFOLIO, "x".repeat(121), AT)).rejects.toThrow();
    await expect(renameProperty(env.DB, PROP, PORTFOLIO, "x".repeat(121))).rejects.toThrow();
    expect((await getProperty(env.DB, PROP))?.label).toBe("Unit A");
  });

  it("trims the label it keeps and is refused for a portfolio that does not exist", async () => {
    expect(await addProperty(env.DB, { id: PROP_2, portfolioId: PORTFOLIO, label: "  Unit B ", synthetic: false, at: AT })).toMatchObject({ label: "Unit B" });
    await expect(addProperty(env.DB, { id: invite(1), portfolioId: "bc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99", label: "Lost", synthetic: false, at: AT })).rejects.toBeInstanceOf(DbRefused);
  });

  it("is renamed and removed only inside its own portfolio, and a removed one is kept but not listed", async () => {
    expect(await renameProperty(env.DB, PROP, OTHER_PORTFOLIO, "Mine now")).toBe(false);
    expect(await removeProperty(env.DB, PROP, OTHER_PORTFOLIO, LATER)).toBe(false);
    expect(await renameProperty(env.DB, PROP, PORTFOLIO, "Unit A2")).toBe(true);
    await addProperty(env.DB, { id: PROP_2, portfolioId: PORTFOLIO, label: "Unit B", synthetic: false, at: LATER });
    expect((await propertiesOf(env.DB, PORTFOLIO)).map((p) => p.label)).toEqual(["Unit A2", "Unit B"]);
    expect(await removeProperty(env.DB, PROP, PORTFOLIO, LATER)).toBe(true);
    expect(await removeProperty(env.DB, PROP, PORTFOLIO, WEEK)).toBe(false);
    expect((await propertiesOf(env.DB, PORTFOLIO)).map((p) => p.label)).toEqual(["Unit B"]);
    expect(await getProperty(env.DB, PROP)).toMatchObject({ label: "Unit A2", removedAt: LATER });
    expect(await renameProperty(env.DB, PROP, PORTFOLIO, "Revived")).toBe(false);
  });

  it("is unknown for an id nobody made", async () => {
    expect(await getProperty(env.DB, "cc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99")).toBeNull();
    expect(await getProperty(env.DB, "not an id")).toBeNull();
  });
});

describe("an invite", () => {
  it("keeps only the hash of its code and never expires before it is made", async () => {
    await createInvite(env.DB, newInvite(1));
    expect(await inviteByHash(env.DB, H1)).toMatchObject({ id: invite(1), propertyId: PROP, label: "Unit A", usedAt: null, walkId: null, expiresAt: WEEK, removed: false });
    const columns = (await env.DB.prepare("SELECT name FROM pragma_table_info('invites')").all<{ name: string }>()).results.map((c) => c.name);
    expect(columns).not.toContain("code");
    await expect(createInvite(env.DB, newInvite(2, { codeHash: H2, expiresAt: AT }))).rejects.toThrow();
    await expect(createInvite(env.DB, newInvite(2, { codeHash: H2, expiresAt: "2026-10-31T09:00:00.000Z" }))).rejects.toThrow();
    await expect(createInvite(env.DB, newInvite(2, { codeHash: H1 }))).rejects.toBeInstanceOf(DbRefused);
    expect(await count("invites")).toBe(1);
  });

  it("is unknown for a hash nobody was given, and for text that is no hash", async () => {
    expect(await inviteByHash(env.DB, H2)).toBeNull();
    expect(await inviteByHash(env.DB, "short")).toBeNull();
    expect(await useInvite(env.DB, { codeHash: H2, walkId: WALK, at: LATER })).toEqual({ ok: false, reason: "unknown" });
  });

  it("is used once: the walk is linked to the property by that invite, and a second use is refused", async () => {
    await createInvite(env.DB, newInvite(1));
    expect(await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER })).toEqual({ ok: true, propertyId: PROP, inviteId: invite(1) });
    expect(await inviteByHash(env.DB, H1)).toMatchObject({ usedAt: LATER, walkId: WALK });
    expect(await env.DB.prepare("SELECT property_id, invite_id, linked_at FROM property_walks WHERE walk_id = ?").bind(WALK).first()).toEqual({ property_id: PROP, invite_id: invite(1), linked_at: LATER });
    expect(await useInvite(env.DB, { codeHash: H1, walkId: OTHER_WALK, at: LATER })).toEqual({ ok: false, reason: "used" });
    expect(await count("property_walks")).toBe(1);
    await expect(sql("UPDATE invites SET used_at = ?, walk_id = ? WHERE id = ?", WEEK, OTHER_WALK, invite(1))).rejects.toThrow("an invite is used once");
  });

  it("is used by one of two walks that start together", async () => {
    await createInvite(env.DB, newInvite(1));
    const answers = await Promise.all([useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER }), useInvite(env.DB, { codeHash: H1, walkId: OTHER_WALK, at: LATER })]);
    expect(answers.filter((a) => a.ok)).toHaveLength(1);
    expect(answers.filter((a) => !a.ok)).toEqual([{ ok: false, reason: "used" }]);
    expect(await count("property_walks")).toBe(1);
  });

  it("is refused once expired, with the invite left unused", async () => {
    await createInvite(env.DB, newInvite(1));
    expect(await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: WEEK })).toEqual({ ok: false, reason: "expired" });
    expect(await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: DAY_AFTER })).toEqual({ ok: false, reason: "expired" });
    expect(await inviteByHash(env.DB, H1)).toMatchObject({ usedAt: null, walkId: null });
    expect(await count("property_walks")).toBe(0);
  });

  it("is refused on a removed property, and leaves the walk unlinked", async () => {
    await createInvite(env.DB, newInvite(1));
    await removeProperty(env.DB, PROP, PORTFOLIO, LATER);
    expect(await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER })).toEqual({ ok: false, reason: "property_removed" });
    expect(await inviteByHash(env.DB, H1)).toMatchObject({ removed: true, usedAt: null });
    expect(await count("property_walks")).toBe(0);
  });

  it("is refused for a walk that does not exist or is linked already, and stays unused", async () => {
    await createInvite(env.DB, newInvite(1));
    await expect(useInvite(env.DB, { codeHash: H1, walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99", at: LATER })).rejects.toBeInstanceOf(DbRefused);
    await linkWalk(env.DB, { walkId: WALK, propertyId: PROP, inviteId: null, at: AT });
    await expect(useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER })).rejects.toBeInstanceOf(DbRefused);
    expect(await inviteByHash(env.DB, H1)).toMatchObject({ usedAt: null, walkId: null });
  });

  it("goes with the property when the account is erased, and its used walk is left alone", async () => {
    await createInvite(env.DB, newInvite(1));
    await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER });
    await sql("DELETE FROM accounts WHERE id = ?", ACCOUNT);
    expect(await count("invites")).toBe(0);
    expect(await count("property_walks")).toBe(0);
    expect(await env.DB.prepare("SELECT id FROM walks WHERE id = ?").bind(WALK).first()).not.toBeNull();
  });
});

describe("a walk on a property", () => {
  it("is linked once: a second property for the same walk is refused", async () => {
    await addProperty(env.DB, { id: PROP_2, portfolioId: PORTFOLIO, label: "Unit B", synthetic: false, at: AT });
    await linkWalk(env.DB, { walkId: WALK, propertyId: PROP, inviteId: null, at: AT });
    await expect(linkWalk(env.DB, { walkId: WALK, propertyId: PROP_2, inviteId: null, at: LATER })).rejects.toBeInstanceOf(DbRefused);
    await expect(sql("INSERT INTO property_walks (walk_id, property_id, linked_at) VALUES (?, ?, ?)", WALK, PROP_2, LATER)).rejects.toThrow();
    expect(await env.DB.prepare("SELECT property_id FROM property_walks WHERE walk_id = ?").bind(WALK).first()).toEqual({ property_id: PROP });
  });

  it("is refused for a property that does not exist", async () => {
    await expect(linkWalk(env.DB, { walkId: WALK, propertyId: "cc0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a99", inviteId: null, at: AT })).rejects.toBeInstanceOf(DbRefused);
  });

  it("goes when the walk goes, and the used invite goes with it", async () => {
    await createInvite(env.DB, newInvite(1));
    await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER });
    await createInvite(env.DB, newInvite(2, { codeHash: H2 }));
    await sql("DELETE FROM walks WHERE id = ?", WALK);
    expect(await count("property_walks")).toBe(0);
    expect((await env.DB.prepare("SELECT id FROM invites").all<{ id: string }>()).results).toEqual([{ id: invite(2) }]);
  });

  it("keeps a linked walk when its invite is deleted, with no invite named", async () => {
    await createInvite(env.DB, newInvite(1));
    await linkWalk(env.DB, { walkId: WALK, propertyId: PROP, inviteId: invite(1), at: AT });
    await sql("DELETE FROM invites WHERE id = ?", invite(1));
    expect(await env.DB.prepare("SELECT invite_id FROM property_walks WHERE walk_id = ?").bind(WALK).first()).toEqual({ invite_id: null });
  });

  it("is found through the account that holds its property, for a tenant's walk and the manager's own, and for nobody else", async () => {
    await createInvite(env.DB, newInvite(1));
    await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER });
    await linkWalk(env.DB, { walkId: OTHER_WALK, propertyId: THEIR_PROP, inviteId: null, at: LATER });
    expect(await accountOfWalk(env.DB, WALK)).toBe(ACCOUNT);
    expect(await accountOfWalk(env.DB, OTHER_WALK)).toBe(OTHER_ACCOUNT);
    expect(await accountOfWalk(env.DB, THIRD)).toBeNull();
    expect(await accountOfWalk(env.DB, "not an id")).toBeNull();
  });

  it("is read with its date, state, who made it and each finding's latest mark, newest walk first", async () => {
    await sql("UPDATE walks SET created_at = '2026-10-20T09:00:00.000Z' WHERE id = ?", WALK);
    await sql("UPDATE walks SET created_at = '2026-10-28T09:00:00.000Z', state = 'failed', step = 'segment' WHERE id = ?", OTHER_WALK);
    await createInvite(env.DB, newInvite(1));
    await useInvite(env.DB, { codeHash: H1, walkId: WALK, at: LATER });
    await linkWalk(env.DB, { walkId: OTHER_WALK, propertyId: PROP, inviteId: null, at: LATER });
    await markFinding(env.DB, { id: markId(1), findingId: FINDING, status: "done", note: "", doneOn: "2026-10-25", markedAt: "2026-10-25T12:00:00.000Z" });
    await markFinding(env.DB, { id: markId(2), findingId: FINDING_2, status: "done", note: "", doneOn: "2026-10-26", markedAt: "2026-10-26T12:00:00.000Z" });
    await markFinding(env.DB, { id: markId(3), findingId: FINDING_2, status: "fix_planned", note: "Crew Tuesday.", doneOn: null, markedAt: "2026-10-27T12:00:00.000Z" });

    const walks = await propertyWalks(env.DB, PROP);
    expect(walks.map((w) => [w.walkId, w.createdAt, w.state, w.viaInvite])).toEqual([
      [OTHER_WALK, "2026-10-28T09:00:00.000Z", "failed", false],
      [WALK, "2026-10-20T09:00:00.000Z", "done", true],
    ]);
    expect(walks[0]?.findings).toEqual([]);
    expect(walks[1]?.findings.map((f) => [f.id, f.concept, f.label, f.status, f.vetoed, f.doneOn, f.markedAt])).toEqual([
      [FINDING, "wood_pile", "required_now", "done", false, "2026-10-25", "2026-10-25T12:00:00.000Z"],
      [FINDING_2, "shrub", "recommended", "fix_planned", false, null, "2026-10-27T12:00:00.000Z"],
    ]);
  });

  it("is read for no other property, and a property with no walk reads as empty", async () => {
    await linkWalk(env.DB, { walkId: WALK, propertyId: THEIR_PROP, inviteId: null, at: LATER });
    expect(await propertyWalks(env.DB, PROP)).toEqual([]);
    expect((await propertyWalks(env.DB, THEIR_PROP)).map((w) => w.walkId)).toEqual([WALK]);
  });

  it("lists one property with six walks as six, the same as one with a single walk", async () => {
    const ids = Array.from({ length: 6 }, (_, n) => `6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7b0${n}`);
    for (const [n, walkId] of ids.entries()) {
      await seedWalk(walkId, "done");
      await sql("UPDATE walks SET created_at = ? WHERE id = ?", `2026-10-2${n}T09:00:00.000Z`, walkId);
      await linkWalk(env.DB, { walkId, propertyId: PROP, inviteId: null, at: LATER });
    }
    await linkWalk(env.DB, { walkId: WALK, propertyId: THEIR_PROP, inviteId: null, at: LATER });
    expect((await propertyWalks(env.DB, PROP)).map((w) => w.walkId)).toEqual([...ids].reverse());
    expect(await propertyWalks(env.DB, THEIR_PROP)).toHaveLength(1);
  });
});

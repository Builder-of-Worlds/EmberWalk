import { env } from "cloudflare:workers";
import type { CacheEntry, CostRecord } from "@emberwalk/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { saveClip } from "../src/clips.ts";
import { DbRefused } from "../src/errors.ts";
import { findingsForWalk, replaceFindings, saveFindings } from "../src/findings.ts";
import { cacheIndex, d1Ledger } from "../src/ledger.ts";
import { clip, finding, FINDING, FINDING_2, OTHER_WALK, resetDb, seedWalk, WALK } from "./fixtures.ts";

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "processing", "score");
  await seedWalk(OTHER_WALK, "processing", "score");
  await saveClip(env.DB, clip());
});

describe("findings", () => {
  it("stores findings and reads them back in rank order", async () => {
    const second = finding({ id: FINDING_2, rank: 2, concept: "shrub", plantState: "dead", spacing: "too_close", voiceNote: "That one is dry.", label: "recommended" });
    await saveFindings(env.DB, [second, finding()]);
    expect(await findingsForWalk(env.DB, WALK)).toEqual([finding(), second]);
  });

  it("keeps a veto and its reason", async () => {
    const vetoed = finding({ veto: { reason: "Looks like a planter, not a wood pile." } });
    await saveFindings(env.DB, [vetoed]);
    expect((await findingsForWalk(env.DB, WALK))[0]?.veto).toEqual({ reason: "Looks like a planter, not a wood pile." });
  });

  it("keeps each walk's findings apart", async () => {
    await saveFindings(env.DB, [finding()]);
    expect(await findingsForWalk(env.DB, OTHER_WALK)).toEqual([]);
  });

  it("refuses a band outside the zones and a severity outside 1 to 10", async () => {
    await expect(saveFindings(env.DB, [finding({ band: "zone_9" as never })])).rejects.toThrow();
    await expect(saveFindings(env.DB, [finding({ severity: 11 })])).rejects.toThrow();
  });

  it("refuses a found finding with no track and a plant state on a wood pile", async () => {
    await expect(saveFindings(env.DB, [finding({ trackIds: [] })])).rejects.toThrow();
    await expect(saveFindings(env.DB, [finding({ plantState: "dead" })])).rejects.toThrow();
  });

  it("refuses two findings with one rank in a walk and stores neither", async () => {
    await expect(saveFindings(env.DB, [finding(), finding({ id: FINDING_2 })])).rejects.toThrow();
    expect(await findingsForWalk(env.DB, WALK)).toEqual([]);
  });

  it("refuses a finding whose proof frame is on a clip that does not exist", async () => {
    const proofFrame = { clipId: "8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff", frame: 1, still: "stills/x.jpg" };
    await expect(saveFindings(env.DB, [finding({ proofFrame })])).rejects.toThrow();
  });

  it("refuses a finding for a walk that does not exist", async () => {
    await expect(saveFindings(env.DB, [finding({ walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff" })])).rejects.toThrow();
  });

  it("is removed with its walk", async () => {
    await saveFindings(env.DB, [finding()]);
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    expect(await findingsForWalk(env.DB, WALK)).toEqual([]);
  });
});

const FINDING_3 = "aa0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a03";
const tapped = () => finding({ id: FINDING_3, rank: 9, source: "tapped", trackIds: [], concept: "shrub", instruction: "Cut back the shrub." });

describe("replacing a walk's found findings", () => {
  it("swaps the found findings for the new ones and keeps the tapped ones", async () => {
    await saveFindings(env.DB, [finding(), tapped()]);
    const fresh = [finding({ id: FINDING_2, concept: "dry_brush", instruction: "Clear the dry brush." })];
    await replaceFindings(env.DB, WALK, fresh);
    expect(await findingsForWalk(env.DB, WALK)).toEqual([...fresh, tapped()]);
  });

  it("gives the same findings once when run twice", async () => {
    await replaceFindings(env.DB, WALK, [finding(), finding({ id: FINDING_2, rank: 2 })]);
    await replaceFindings(env.DB, WALK, [finding(), finding({ id: FINDING_2, rank: 2 })]);
    expect((await findingsForWalk(env.DB, WALK)).map((f) => f.id)).toEqual([FINDING, FINDING_2]);
  });

  it("clears the found findings when there are none, and leaves another walk alone", async () => {
    await saveFindings(env.DB, [finding(), tapped(), finding({ id: FINDING_2, walkId: OTHER_WALK })]);
    await replaceFindings(env.DB, WALK, []);
    expect(await findingsForWalk(env.DB, WALK)).toEqual([tapped()]);
    expect((await findingsForWalk(env.DB, OTHER_WALK)).map((f) => f.id)).toEqual([FINDING_2]);
  });

  it("refuses a bad finding and changes nothing", async () => {
    await saveFindings(env.DB, [finding()]);
    await expect(replaceFindings(env.DB, WALK, [finding({ id: FINDING_2, severity: 11 })])).rejects.toThrow();
    expect(await findingsForWalk(env.DB, WALK)).toEqual([finding()]);
  });

  it("refuses a finding of another walk, a tapped finding and a rank a tapped finding holds, and changes nothing", async () => {
    await saveFindings(env.DB, [finding(), tapped()]);
    await expect(replaceFindings(env.DB, WALK, [finding({ id: FINDING_2, walkId: OTHER_WALK })])).rejects.toThrow(DbRefused);
    await expect(replaceFindings(env.DB, WALK, [{ ...tapped(), id: FINDING_2, rank: 3 }])).rejects.toThrow(DbRefused);
    await expect(replaceFindings(env.DB, WALK, [finding({ id: FINDING_2, rank: 9 })])).rejects.toThrow(DbRefused);
    expect(await findingsForWalk(env.DB, WALK)).toEqual([finding(), tapped()]);
  });
});

const cost = (over: Partial<CostRecord> = {}): CostRecord => ({
  id: "bb0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a01",
  at: "2026-10-26T18:00:00.000Z",
  model: "sam-3.1",
  step: "segment",
  walkId: WALK,
  units: { kind: "frames", count: 50 },
  unitPriceUsd: 0.0002,
  totalUsd: 0.01,
  cached: false,
  ...over,
});

describe("the spend ledger", () => {
  it("adds up a day's cost and ignores other days", async () => {
    const ledger = d1Ledger(env.DB);
    await ledger.record(cost());
    await ledger.record(cost({ id: "bb0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a02", totalUsd: 0.0125 }));
    await ledger.record(cost({ id: "bb0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a03", at: "2026-10-27T01:00:00.000Z", totalUsd: 5 }));
    expect(await ledger.spentUsd("2026-10-26")).toBeCloseTo(0.0225, 9);
    expect(await ledger.spentUsd("2026-10-27")).toBe(5);
  });

  it("reports zero for a day with no calls", async () => {
    expect(await d1Ledger(env.DB).spentUsd("2026-10-25")).toBe(0);
  });

  it("counts a cached answer as free", async () => {
    const ledger = d1Ledger(env.DB);
    await ledger.record(cost({ cached: true, totalUsd: 0 }));
    expect(await ledger.spentUsd("2026-10-26")).toBe(0);
  });

  it("keeps a record after its walk is deleted", async () => {
    const ledger = d1Ledger(env.DB);
    await ledger.record(cost());
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    expect(await ledger.spentUsd("2026-10-26")).toBeCloseTo(0.01, 9);
  });

  it("refuses a cached answer that costs money, a negative price and a repeated id", async () => {
    const ledger = d1Ledger(env.DB);
    await expect(ledger.record(cost({ cached: true, totalUsd: 1 }))).rejects.toThrow();
    await expect(ledger.record(cost({ totalUsd: -1 }))).rejects.toThrow();
    await ledger.record(cost());
    await expect(ledger.record(cost())).rejects.toThrow();
    expect(await ledger.spentUsd("2026-10-26")).toBeCloseTo(0.01, 9);
  });

  it("refuses a day that is not a date", async () => {
    await expect(d1Ledger(env.DB).spentUsd("today")).rejects.toThrow();
  });
});

const entry = (over: Partial<CacheEntry> = {}): CacheEntry => ({
  fingerprint: "c".repeat(64),
  model: "sam-3.1",
  createdAt: "2026-10-26T18:00:00.000Z",
  answer: `cache/${"c".repeat(64)}.json`,
  ...over,
});

describe("the cache index", () => {
  it("finds an entry by its fingerprint", async () => {
    const index = cacheIndex(env.DB);
    await index.put(entry());
    expect(await index.get("c".repeat(64))).toEqual(entry());
  });

  it("returns null for an unknown fingerprint", async () => {
    expect(await cacheIndex(env.DB).get("d".repeat(64))).toBeNull();
  });

  it("keeps the first entry when the same answer is stored twice", async () => {
    const index = cacheIndex(env.DB);
    await index.put(entry());
    await index.put(entry({ createdAt: "2026-10-27T00:00:00.000Z" }));
    expect((await index.get("c".repeat(64)))?.createdAt).toBe("2026-10-26T18:00:00.000Z");
  });

  it("refuses a fingerprint that is not 64 hex digits and an answer outside the cache folder", async () => {
    const index = cacheIndex(env.DB);
    await expect(index.put(entry({ fingerprint: "abc" }))).rejects.toThrow();
    await expect(index.put(entry({ answer: "originals/x.json" }))).rejects.toThrow(/cache folder/);
    await expect(index.get("abc")).rejects.toThrow();
  });
});

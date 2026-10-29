import { CATALOG, isPending, POINT_LOOKS, rowsForClip, samPhraseOf, walkCost } from "@emberwalk/catalog";
import type { SamFrame } from "@emberwalk/meta";
import { LOOP_CONCEPTS } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { storedConcept, tallyFrames, tallyNotChecked, tallyWalk } from "../src/catalog-step.ts";
import { segmentClip } from "../src/segment.ts";
import { detectionsKey } from "../src/storage.ts";
import { costRows, freshWalkId, resetAll, seedClip, seedWalk, spentNano } from "./fixtures.ts";
import { harness, stageCatalogYard, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);

const requestsTo = (path: string) => harness.requests.filter((r) => r.path === path);

const setup = async (options: { synthetic?: boolean; kind?: "loop" | "pan" } = {}) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing", ...(options.synthetic === undefined ? {} : { synthetic: options.synthetic }) });
  const clip = await seedClip(walkId, 1, options.kind ?? "loop");
  return { walkId, clip };
};

const pendingRows = CATALOG.filter(isPending);

const BOX = { left: 0, top: 0, right: 10, bottom: 10, frameWidth: 100, frameHeight: 100 };
const MASK = { encoding: "one_bit", height: 1, width: 1, payload: "" } as const;
const frame = (n: number, ...scores: (number | null)[]): SamFrame => ({
  frame: n,
  objects: scores.map((confidence, i) => ({ id: String(i), box: BOX, mask: MASK, confidence })),
});

const readDetections = async (walkId: string, clipId: string) =>
  (await (await env.MEDIA.get(detectionsKey(walkId, clipId)))!.json()) as { runs: { concept: string }[]; tracks: { concept: string }[] };

beforeEach(resetAll);

describe("tallying an answer for an object the rules engine cannot yet explain", () => {
  const gas = pendingRows.find((r) => r.concept === "gas_can")!;

  it("counts the frames it shows on and keeps the best score", () => {
    expect(tallyFrames(gas, "clip-1", [frame(1, 0.4), frame(2, 0.9, 0.6), frame(3)])).toEqual({
      object: "gas_can",
      clipId: "clip-1",
      outcome: "found",
      framesFound: 2,
      bestScore: 0.9,
      reason: null,
    });
  });

  it("reports none when no frame shows it", () => {
    expect(tallyFrames(gas, "clip-1", [frame(1), frame(2)])).toMatchObject({ outcome: "none", framesFound: 0, bestScore: null });
    expect(tallyFrames(gas, "clip-1", [])).toMatchObject({ outcome: "none", framesFound: 0, bestScore: null });
  });

  it("has no best score when the answer carried none", () => {
    expect(tallyFrames(gas, "clip-1", [frame(1, null)])).toMatchObject({ outcome: "found", framesFound: 1, bestScore: null });
  });

  it("says why an object was not checked", () => {
    expect(tallyNotChecked(gas, "clip-1", "SAM answered 500")).toEqual({
      object: "gas_can",
      clipId: "clip-1",
      outcome: "not_checked",
      framesFound: 0,
      bestScore: null,
      reason: "SAM answered 500",
    });
  });

  it("adds the clips of a walk together, object by object", () => {
    const a = tallyFrames(gas, "clip-1", [frame(1, 0.4)]);
    const b = tallyFrames(gas, "clip-2", [frame(1, 0.8), frame(2, 0.5)]);
    const c = tallyNotChecked(pendingRows.find((r) => r.concept === "tarp")!, "clip-2", "SAM answered 500");

    expect(tallyWalk([a, b, c])).toEqual([
      { object: "gas_can", outcome: "found", clipsFound: 2, framesFound: 3, bestScore: 0.8, reasons: [] },
      { object: "tarp", outcome: "not_checked", clipsFound: 0, framesFound: 0, bestScore: null, reasons: ["SAM answered 500"] },
    ]);
  });

  it("calls an object found if any clip found it, even when another clip could not check it", () => {
    const a = tallyFrames(gas, "clip-1", [frame(1, 0.4)]);
    const b = tallyNotChecked(gas, "clip-2", "SAM answered 500");

    expect(tallyWalk([a, b])).toEqual([{ object: "gas_can", outcome: "found", clipsFound: 1, framesFound: 1, bestScore: 0.4, reasons: ["SAM answered 500"] }]);
  });

  it("refuses to store a track for it", () => {
    expect(() => storedConcept(gas)).toThrow(/gas_can/);
    expect(storedConcept(CATALOG.find((r) => r.concept === "shed")!)).toBe("shed");
  });
});

describe("segmentClip over the whole catalog", () => {
  it("asks for every catalog row once per loop clip", async () => {
    const { walkId, clip } = await setup();
    stageCatalogYard(harness);

    await segmentClip(deps(), walkId, clip, "file-1");

    const samPhrases = harness.asked.filter((text) => !text.startsWith("Find the"));
    const expected = rowsForClip("loop").filter((r) => r.point === null).map(samPhraseOf);
    expect([...samPhrases].sort()).toEqual([...expected].sort());
    expect(new Set(samPhrases).size).toBe(samPhrases.length);
    expect(requestsTo("/responses")).toHaveLength(expected.length + 2 * POINT_LOOKS);
  });

  it("asks the pan clip for the pending objects as well", async () => {
    const { walkId, clip } = await setup({ kind: "pan" });
    stageCatalogYard(harness);

    await segmentClip(deps(), walkId, clip, "file-1");

    for (const row of pendingRows) expect(harness.asked).toContain(samPhraseOf(row));
    expect(requestsTo("/responses")).toHaveLength(rowsForClip("pan").length - 1 + POINT_LOOKS);
  });

  it("returns pending objects in the tally and stores tracks only for existing concepts", async () => {
    const { walkId, clip } = await setup();
    stageCatalogYard(harness);

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true, value: { clipId: clip.id, found: 1, notChecked: 0 } });
    const value = (result as { value: { pending: ReturnType<typeof tallyFrames>[] } }).value;
    expect(value.pending.map((t) => t.object)).toEqual(pendingRows.map((r) => r.concept));
    const byObject = Object.fromEntries(value.pending.map((t) => [t.object, t]));
    expect(byObject["gas_can"]).toMatchObject({ outcome: "found", framesFound: 2, bestScore: 0.81, clipId: clip.id });
    expect(byObject["lawn_mower"]).toMatchObject({ outcome: "found", framesFound: 3, bestScore: 0.91 });
    expect(byObject["vehicle"]).toMatchObject({ outcome: "none", framesFound: 0, bestScore: null });

    const stored = await readDetections(walkId, clip.id);
    expect(stored.runs).toHaveLength(LOOP_CONCEPTS.length);
    expect(stored.tracks.map((t) => t.concept)).toEqual(["wood_pile"]);
    const rows = await env.DB.prepare("SELECT COUNT(*) AS n FROM concept_runs").first<{ n: number }>();
    expect(rows?.n ?? 0).toBe(0);
  });

  it("refuses a malformed answer for one object and still returns the others", async () => {
    const { walkId, clip } = await setup();
    stageCatalogYard(harness);
    harness.answers["gas can"] = [{ text: "<1f>this is not a SAM record" }];

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    const pending = (result as { value: { pending: ReturnType<typeof tallyFrames>[] } }).value.pending;
    const byObject = Object.fromEntries(pending.map((t) => [t.object, t]));
    expect(byObject["gas_can"]).toMatchObject({ outcome: "not_checked", framesFound: 0 });
    expect(byObject["gas_can"]?.reason).toContain("SAM answer refused");
    expect(byObject["lawn_mower"]).toMatchObject({ outcome: "found", framesFound: 3 });
    expect(byObject["tarp"]).toMatchObject({ outcome: "found", framesFound: 2 });
  });

  it("starts no call for a walk whose estimate passes the cap", async () => {
    const { walkId, clip } = await setup();
    stageCatalogYard(harness);
    const estimate = walkCost([clip]).nano;
    harness.capUsd = (estimate - 1) / 1e9;

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: false, failure: { code: "spend_limit" } });
    expect(requestsTo("/responses")).toHaveLength(0);
    expect(await env.MEDIA.head(detectionsKey(walkId, clip.id))).toBeNull();
    expect(await costRows()).toBe(0);
  });

  it("goes ahead when the estimate is exactly the cap, and spends no more than the estimate", async () => {
    const { walkId, clip } = await setup();
    stageCatalogYard(harness);
    const estimate = walkCost([clip]).nano;
    harness.capUsd = estimate / 1e9;

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: true });
    expect(await spentNano()).toBeGreaterThan(0);
    expect(await spentNano()).toBeLessThanOrEqual(estimate);
  });

  it("refuses real footage on free credits as it does today", async () => {
    const { walkId, clip } = await setup({ synthetic: false });

    const result = await segmentClip(deps(), walkId, clip, "file-1");

    expect(result).toMatchObject({ ok: false, failure: { code: "real_footage_not_allowed" } });
    expect(requestsTo("/responses")).toHaveLength(0);
  });
});

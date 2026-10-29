import { CATALOG, isPending, walkCost } from "@emberwalk/catalog";
import { LOOP_CONCEPTS } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import truth from "../../../fixtures/catalog/yard-objects/truth.json";
import answers from "../../../fixtures/catalog/yard-objects/answers.json";
import { type PendingTally, tallyWalk } from "../src/catalog-step.ts";
import { segmentClip } from "../src/segment.ts";
import { detectionsKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedClip, seedWalk, spentNano } from "./fixtures.ts";
import { harness, stageCatalogYard, testDeps } from "./harness.ts";

type Stored = { runs: { concept: string }[]; tracks: { concept: string }[] };

const deps = () => testDeps(env, harness);

const walkOnTheYard = async () => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing" });
  const clips = [await seedClip(walkId, 1, "loop"), await seedClip(walkId, 2, "pan")];
  stageCatalogYard(harness);
  const tallies: PendingTally[] = [];
  const stored: Stored[] = [];
  for (const clip of clips) {
    const result = await segmentClip(deps(), walkId, clip, `file-${clip.kind}`);
    if (!result.ok) throw new Error(`segment refused: ${result.failure.code}`);
    tallies.push(...(result.value as { pending: PendingTally[] }).pending);
    stored.push((await (await env.MEDIA.get(detectionsKey(walkId, clip.id)))!.json()) as Stored);
  }
  return { clips, tallies, stored };
};

beforeEach(resetAll);

describe("the yard fixture", () => {
  it("is labelled synthetic and its answers are the truth's boxes, phrase by phrase", () => {
    expect(truth.synthetic).toBe(true);
    expect(truth.label).toBe("Synthetic sample house");
    expect(answers.synthetic).toBe(true);
    for (const hazard of truth.hazards) {
      const sam = (answers.sam as Record<string, { frame: number; box: number[] }[]>)[hazard.concept];
      expect(sam?.map((s) => ({ frame: s.frame, box: s.box }))).toEqual(hazard.frame_boxes.map((f) => ({ frame: f.frame, box: f.box_px })));
    }
  });

  it("places one existing concept and four objects the rules engine cannot yet explain", () => {
    const placed = truth.hazards.map((h) => CATALOG.find((r) => r.concept === h.catalog_concept));
    expect(placed.every((row) => row !== undefined)).toBe(true);
    expect(placed.filter((row) => row !== undefined && !isPending(row))).toHaveLength(1);
    expect(placed.filter((row) => row !== undefined && isPending(row))).toHaveLength(4);
    for (const hazard of truth.hazards) expect(hazard.pending).toBe(isPending(CATALOG.find((r) => r.concept === hazard.catalog_concept)!));
  });
});

describe("a whole walk through the catalog on the yard fixture", () => {
  it("stores tracks only for existing concepts", async () => {
    const { stored } = await walkOnTheYard();

    for (const detections of stored) {
      expect(detections.tracks.length).toBeGreaterThan(0);
      for (const track of detections.tracks) expect(LOOP_CONCEPTS as readonly string[]).toContain(track.concept);
      for (const run of detections.runs) expect(LOOP_CONCEPTS as readonly string[]).toContain(run.concept);
    }
    expect(stored.flatMap((d) => d.tracks.map((t) => t.concept))).toEqual(["wood_pile", "wood_pile"]);
  });

  it("tallies the four pending objects the yard holds and the six it does not", async () => {
    const { tallies } = await walkOnTheYard();

    const walk = tallyWalk(tallies);

    expect(walk.map((w) => w.object)).toEqual(CATALOG.filter(isPending).map((r) => r.concept));
    const found = walk.filter((w) => w.outcome === "found");
    expect(found.map((w) => w.object).sort()).toEqual(["gas_can", "grill", "lawn_mower", "tarp"]);
    expect(walk.find((w) => w.object === "lawn_mower")).toMatchObject({ clipsFound: 2, framesFound: 6, bestScore: 0.91 });
    expect(walk.find((w) => w.object === "grill")).toMatchObject({ clipsFound: 2, framesFound: 2, bestScore: 0.67 });
    for (const w of walk.filter((x) => x.outcome === "none")) expect(w).toMatchObject({ clipsFound: 0, framesFound: 0, bestScore: null });
    expect(walk.filter((w) => w.outcome === "none")).toHaveLength(6);
  });

  it("spends no more than the walk's estimate", async () => {
    const { clips } = await walkOnTheYard();

    expect(await spentNano()).toBeGreaterThan(0);
    expect(await spentNano()).toBeLessThanOrEqual(walkCost(clips).nano);
  });
});

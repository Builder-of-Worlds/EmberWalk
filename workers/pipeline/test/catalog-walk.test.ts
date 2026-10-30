import { CATALOG, isPending, walkCost } from "@emberwalk/catalog";
import { Concept, OBJECT_CONCEPTS } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import truth from "../../../fixtures/catalog/yard-objects/truth.json";
import answers from "../../../fixtures/catalog/yard-objects/answers.json";
import type { PendingTally } from "../src/catalog-step.ts";
import { segmentClip } from "../src/segment.ts";
import { detectionsKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedClip, seedWalk, spentNano } from "./fixtures.ts";
import { harness, stageCatalogYard, testDeps } from "./harness.ts";

type Stored = { runs: { concept: string; outcome: string }[]; tracks: { concept: string }[] };

const YARD = ["gas_can", "grill", "lawn_mower", "tarp", "wood_pile"];

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

  it("places one plant concept and four of the ten yard objects, every one a concept a walk can store", () => {
    const placed = truth.hazards.map((h) => CATALOG.find((r) => r.concept === h.catalog_concept));
    expect(placed.every((row) => row !== undefined && !isPending(row))).toBe(true);
    expect(placed.map((row) => row?.concept).sort()).toEqual(YARD);
    for (const hazard of truth.hazards) expect(hazard.pending).toBe(false);
  });
});

describe("a whole walk through the catalog on the yard fixture", () => {
  it("stores a track for every hazard the yard holds on both clips, and tallies nothing", async () => {
    const { stored, tallies } = await walkOnTheYard();

    expect(tallies).toEqual([]);
    for (const detections of stored) {
      expect(detections.tracks.map((t) => t.concept).sort()).toEqual(YARD);
      for (const run of detections.runs) expect(Concept.options as readonly string[]).toContain(run.concept);
    }
  });

  it("finds the four yard objects the yard holds on both clips, and none of the six it does not", async () => {
    const { stored } = await walkOnTheYard();

    for (const detections of stored) {
      const objects = detections.runs.filter((r) => (OBJECT_CONCEPTS as readonly string[]).includes(r.concept));
      expect(objects).toHaveLength(10);
      expect(objects.filter((r) => r.outcome === "found").map((r) => r.concept).sort()).toEqual(["gas_can", "grill", "lawn_mower", "tarp"]);
      expect(objects.filter((r) => r.outcome === "none")).toHaveLength(6);
    }
  });

  it("spends no more than the walk's estimate", async () => {
    const { clips } = await walkOnTheYard();

    expect(await spentNano()).toBeGreaterThan(0);
    expect(await spentNano()).toBeLessThanOrEqual(walkCost(clips).nano);
  });
});

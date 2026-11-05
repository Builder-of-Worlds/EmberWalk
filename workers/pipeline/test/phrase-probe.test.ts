import { addTag, clipsForWalk, detectionsForClip } from "@emberwalk/db";
import { MetaRefused } from "@emberwalk/meta";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { probePhrases } from "../src/phrase-probe.ts";
import { freshWalkId, resetAll, seedClip, seedWalk, spentNano } from "./fixtures.ts";
import { harness, idFor, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);
const sightings = [
  { frame: 0, id: 0, box: [32, 33, 159, 166] as [number, number, number, number], confidence: 0.9 },
  { frame: 1, id: 0, box: [48, 50, 175, 183] as [number, number, number, number], confidence: 0.8 },
];
const responses = () => harness.requests.filter((r) => r.path === "/responses");

const finishedWalk = async (options: { synthetic?: boolean; state?: string } = {}) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: options.state ?? "done", ...(options.synthetic === undefined ? {} : { synthetic: options.synthetic }) });
  await seedClip(walkId, 2, "pan");
  const loop = await seedClip(walkId, 1, "loop");
  return { walkId, loop };
};

beforeEach(resetAll);

describe("asking SAM other words on a finished walk", () => {
  it("asks each phrase once on the loop clip, in order, and keeps a track only for what it found", async () => {
    const { walkId, loop } = await finishedWalk();
    harness.answers["leaf pile"] = [{ found: sightings }];

    const answers = await probePhrases(deps(), walkId, [
      { concept: "foundation_vent", phrase: "leaf pile" },
      { concept: "roof_debris", phrase: "gutter leaves" },
    ]);

    expect(harness.asked).toEqual(["leaf pile", "gutter leaves"]);
    expect(answers.map((a) => [a.concept, a.phrase, a.clipId, a.run.outcome, a.tracks.length])).toEqual([
      ["foundation_vent", "leaf pile", loop.id, "found", 1],
      ["roof_debris", "gutter leaves", loop.id, "none", 0],
    ]);
    expect(answers[0]!.tracks[0]).toMatchObject({ concept: "foundation_vent", clipId: loop.id });
    expect(answers[0]!.tracks[0]!.frames.map((f) => f.confidence)).toEqual([0.9, 0.8]);
  });

  it("leaves the walk's own stored detections as they were", async () => {
    const { walkId, loop } = await finishedWalk();
    harness.answers["leaf pile"] = [{ found: sightings }];
    const before = await detectionsForClip(env.DB, loop.id);

    await probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }]);

    expect(await detectionsForClip(env.DB, loop.id)).toEqual(before);
  });

  it("pays once for words asked for two concepts", async () => {
    const { walkId } = await finishedWalk();
    harness.answers["dead leaves"] = [{ found: sightings }];

    const answers = await probePhrases(deps(), walkId, [
      { concept: "foundation_vent", phrase: "dead leaves" },
      { concept: "roof_debris", phrase: "dead leaves" },
    ]);

    expect(responses()).toHaveLength(1);
    expect(answers.map((a) => [a.concept, a.tracks.length])).toEqual([
      ["foundation_vent", 1],
      ["roof_debris", 1],
    ]);
  });

  it("marks words SAM refused as not checked and still asks the rest", async () => {
    const { walkId } = await finishedWalk();
    harness.answers["vent cover"] = [{ status: 400 }];
    harness.answers["tree branch"] = [{ found: sightings }];

    const answers = await probePhrases(deps(), walkId, [
      { concept: "foundation_vent", phrase: "vent cover" },
      { concept: "tree_branch_over_roof", phrase: "tree branch" },
    ]);

    expect(answers.map((a) => [a.run.outcome, a.run.reason === null, a.tracks.length])).toEqual([
      ["not_checked", false, 0],
      ["found", true, 1],
    ]);
  });

  it("drops the uploaded clip when it is done, and when a call stops it", async () => {
    const { walkId } = await finishedWalk();
    await probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }]);
    expect(harness.requests.filter((r) => r.method === "DELETE")).toHaveLength(1);

    harness.capUsd = 0.000001;
    await expect(probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "dead leaves" }])).rejects.toBeInstanceOf(MetaRefused);
    expect(harness.requests.filter((r) => r.method === "DELETE")).toHaveLength(2);
  });

  it("spends nothing past the cap", async () => {
    const { walkId } = await finishedWalk();
    harness.capUsd = 0.000001;
    await expect(probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }])).rejects.toThrow(/daily_cap_reached|spent/);
    expect(responses()).toHaveLength(0);
    expect(await spentNano()).toBe(0);
  });

  it("cuts the loop clip again from the original when the finished walk's clip was deleted, as the walk first cut it", async () => {
    const { walkId, loop } = await finishedWalk();
    await env.MEDIA.delete(loop.file);
    harness.answers["leaf pile"] = [{ found: sightings }];

    const answers = await probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }]);

    expect(harness.clipped).toHaveLength(1);
    expect(harness.clipped[0]).toMatchObject({ start: 0, end: 120, fps: 2, maxHeight: 720 });
    expect(harness.clipped[0]!.input).toContain(`originals/${walkId}/walk.mp4`);
    expect(harness.clipped[0]!.output).toContain(loop.file);
    expect(answers[0]!.tracks).toHaveLength(1);
  });

  it("asks on the pan clip when told to, and cuts it again from the pan's own span when it was deleted", async () => {
    const { walkId } = await finishedWalk();
    const pan = (await clipsForWalk(env.DB, walkId)).find((c) => c.kind === "pan")!;
    await addTag(env.DB, { id: idFor(4100), walkId, kind: "loop", startSeconds: 0, endSeconds: 60, label: "front", samples: [], propertyLine: null });
    await addTag(env.DB, { id: idFor(4101), walkId, kind: "pan", startSeconds: 60, endSeconds: 90, label: "corner 1", samples: [], propertyLine: null });
    await env.MEDIA.delete(pan.file);
    harness.answers["dry brush"] = [{ found: sightings }];

    const answers = await probePhrases(deps(), walkId, [{ concept: "dry_brush", phrase: "dry brush" }], "pan");

    expect(harness.clipped).toHaveLength(1);
    expect(harness.clipped[0]).toMatchObject({ start: 60, end: 90, fps: 2 });
    expect(harness.clipped[0]!.output).toContain(pan.file);
    expect(answers.map((a) => [a.clipId, a.run.outcome, a.tracks.length])).toEqual([[pan.id, "found", 1]]);
  });

  it("cuts nothing when the loop clip is still stored", async () => {
    const { walkId } = await finishedWalk();
    await probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }]);
    expect(harness.clipped).toHaveLength(0);
  });

  it("refuses a recut clip whose frames or size differ from the stored clip, before any call, and keeps no clip", async () => {
    const { walkId, loop } = await finishedWalk();
    await env.MEDIA.delete(loop.file);
    harness.clip = { frames: 59, fps: 2, width: 320, height: 334 };

    await expect(probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }])).rejects.toThrow(/59 frames.*stored one has 60/);

    expect(harness.requests).toHaveLength(0);
    expect(await env.MEDIA.get(loop.file)).toBeNull();
  });

  it.each([
    ["a real walk", { synthetic: false }],
    ["a walk still processing", { state: "processing" }],
  ])("refuses %s before any call", async (_name, options) => {
    const { walkId } = await finishedWalk(options);
    await expect(probePhrases(deps(), walkId, [{ concept: "foundation_vent", phrase: "leaf pile" }])).rejects.toThrow(/finished synthetic walk/);
    expect(harness.requests).toHaveLength(0);
  });
});

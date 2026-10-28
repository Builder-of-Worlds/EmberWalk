import { addTag, type ConceptRun, gapsForWalk, saveClip, storeDetections, tagsForWalk } from "@emberwalk/db";
import { CoverageRecord, coverageKey } from "@emberwalk/rules";
import type { Clip, MotionSample, Track } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { checkCoverage, notCheckedConcepts, samplesWithin } from "../src/coverage-step.ts";
import { clipKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedWalk } from "./fixtures.ts";
import { harness, idFor, SAME_PLACE_PHRASE, stageSamePlace, testDeps } from "./harness.ts";

beforeEach(resetAll);

const deps = () => testDeps(env, harness);
const norm = (degrees: number) => ((degrees % 360) + 360) % 360;

const FPS = 2;

const circuit = (legs: number, { hold = 20, turn = 4, direction = 1 } = {}): MotionSample[] => {
  const samples: MotionSample[] = [];
  let t = 0;
  let heading = 0;
  for (let leg = 0; leg < legs; leg++) {
    for (let s = 0; s < hold; s++) samples.push({ t: t++, tiltDegrees: 10, headingDegrees: norm(heading) });
    for (let s = 1; s <= turn; s++) samples.push({ t: t++, tiltDegrees: 10, headingDegrees: norm(heading + (direction * 90 * s) / turn) });
    heading += direction * 90;
  }
  return samples;
};

type Options = { legs?: number; synthetic?: boolean; wallBottom?: number; pans?: number; loopTag?: boolean };

const seeded = async (options: Options = {}) => {
  const { legs = 4, synthetic = true, wallBottom = 0.8, pans = 4, loopTag = true } = options;
  const walkId = freshWalkId();
  const n = Number(walkId.slice(-4));
  await seedWalk(walkId, { synthetic });
  const samples = circuit(legs);
  const seconds = samples.length;
  const clip: Clip = { id: idFor(2000 + n), walkId, kind: "loop", file: clipKey(walkId, "loop"), fps: FPS, frameCount: seconds * FPS, width: 320, height: 334 };
  await env.MEDIA.put(clip.file, new Uint8Array(32));
  await saveClip(env.DB, clip);
  if (loopTag) {
    await addTag(env.DB, { id: idFor(3000 + n), walkId, kind: "loop", startSeconds: 0, endSeconds: seconds, label: "Walk", samples, propertyLine: null });
  }
  for (let p = 0; p < pans; p++) {
    await addTag(env.DB, { id: idFor(3100 + n * 10 + p), walkId, kind: "pan", startSeconds: seconds + p, endSeconds: seconds + p + 1, label: `corner ${p}`, samples: [], propertyLine: null });
  }
  const wall: Track = {
    id: idFor(4000 + n),
    clipId: clip.id,
    concept: "house_wall",
    samObjectId: 1,
    frames: Array.from({ length: Math.floor(seconds / 3) }, (_, i) => ({ frame: i * 3 * FPS, box: [0.1, 0.3, 0.9, wallBottom], mask: null, confidence: 0.9 })),
  };
  const runs: ConceptRun[] = [{ concept: "house_wall", outcome: "found", reason: null, framesBilled: clip.frameCount }];
  await storeDetections(env.DB, { clipId: clip.id, runs, tracks: [wall] });
  return { walkId, clips: [clip], samples };
};

const recordOf = async (walkId: string) => {
  const stored = await env.MEDIA.get(coverageKey(walkId));
  if (stored === null) throw new Error("no coverage record was written");
  return CoverageRecord.parse(await stored.json());
};

const lookKeys = async (walkId: string) => (await env.MEDIA.list({ prefix: `clips/${walkId}/` })).objects.map((o) => o.key).filter((k) => k.includes("/look/"));

const askedForLook = () => harness.asked.filter((phrase) => phrase === SAME_PLACE_PHRASE).length;

describe("the coverage step on a walk that went all the way around", () => {
  it("writes a closed loop with no side gap, and coverage not checked because light is not measured", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded();

    const outcome = await checkCoverage(deps(), walkId, clips);

    const record = await recordOf(walkId);
    expect(record).toMatchObject({ walkId, loop: "closed", coverage: "not_checked", look: { same: true, confidence: 0.9 } });
    expect(record.gaps).toEqual([]);
    expect(outcome).toEqual({ coverage: "not_checked", loop: "closed", gaps: 0 });
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("cuts two stills from the loop clip, 2 seconds after its start and 2 seconds before its end, and leaves none in R2", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded();

    await checkCoverage(deps(), walkId, clips);

    const look = harness.stilled.find((request) => request.stills.length === 2);
    expect(look?.stills.map((s) => s.time)).toEqual([2, 94]);
    expect(await lookKeys(walkId)).toEqual([]);
    expect(askedForLook()).toBe(1);
  });

  it("writes a missing gap with its hint for each of the last two sides when the walk turned 180 degrees", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ legs: 2 });

    await checkCoverage(deps(), walkId, clips);

    expect(await gapsForWalk(env.DB, walkId)).toEqual([
      { side: "right", kind: "missing", hint: "walk_side" },
      { side: "back", kind: "missing", hint: "walk_side" },
    ]);
    expect((await recordOf(walkId)).loop).toBe("open");
  });

  it("writes first_five_feet with a hint when the wall base never shows", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ wallBottom: 0.99 });

    await checkCoverage(deps(), walkId, clips);

    const gaps = await gapsForWalk(env.DB, walkId);
    expect(gaps.map((g) => g.kind)).toEqual(["first_five_feet", "first_five_feet", "first_five_feet", "first_five_feet"]);
    expect(gaps.every((g) => g.hint === "tilt_down" || g.hint === "step_back")).toBe(true);
  });

  it("keeps the tags it read in time order for walks that sent one loop tag per side", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips, samples } = await seeded({ loopTag: false });
    const half = Math.floor(samples.length / 2);
    const n = Number(walkId.slice(-4));
    await addTag(env.DB, { id: idFor(3500 + n), walkId, kind: "loop", startSeconds: half, endSeconds: samples.length, label: "back", samples: samples.slice(half), propertyLine: null });
    await addTag(env.DB, { id: idFor(3501 + n), walkId, kind: "loop", startSeconds: 0, endSeconds: half, label: "front", samples: samples.slice(0, half), propertyLine: null });

    await checkCoverage(deps(), walkId, clips);

    expect((await tagsForWalk(env.DB, walkId)).filter((t) => t.kind === "loop")).toHaveLength(2);
    expect((await recordOf(walkId)).loop).toBe("closed");
  });
});

describe("the coverage step on walks it cannot fully check", () => {
  it("records the look as not checked and completes when the answer is malformed", async () => {
    stageSamePlace("not json at all");
    const { walkId, clips } = await seeded();

    const outcome = await checkCoverage(deps(), walkId, clips);

    const record = await recordOf(walkId);
    expect(record.look).toEqual({ notChecked: expect.stringContaining("refused") });
    expect(record.loop).toBe("not_checked");
    expect(outcome.coverage).toBe("not_checked");
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("records not checked, asks for no look and writes no side gap when the walk has no loop clip", async () => {
    const walkId = freshWalkId();
    await seedWalk(walkId);

    const outcome = await checkCoverage(deps(), walkId, []);

    const record = await recordOf(walkId);
    expect(record).toMatchObject({ loop: "not_checked", coverage: "not_checked" });
    expect(record.look).toEqual({ notChecked: expect.any(String) });
    expect(askedForLook()).toBe(0);
    expect(harness.stilled).toEqual([]);
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
    expect(outcome.loop).toBe("not_checked");
  });

  it("asks for no look on a loop under 5 seconds", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded();
    const short: Clip = { ...(clips[0] as Clip), frameCount: 8 };

    await checkCoverage(deps(), walkId, [short]);

    expect(askedForLook()).toBe(0);
    expect((await recordOf(walkId)).look).toEqual({ notChecked: expect.any(String) });
  });

  it("records the look as not checked, starts no request and leaves no still past the daily cap", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    harness.capUsd = 0.001;
    const { walkId, clips } = await seeded();

    await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).look).toEqual({ notChecked: expect.stringContaining("daily_cap_reached") });
    expect(askedForLook()).toBe(0);
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("records the look as not checked and starts no request on real footage while free credits are in use", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ synthetic: false });

    await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).look).toEqual({ notChecked: expect.stringContaining("real_content_on_free_credits") });
    expect(askedForLook()).toBe(0);
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("records the look as not checked when the stills cannot be cut", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    harness.stills = { refuse: { code: "media_refused", message: "The media container refused the video." } };
    const { walkId, clips } = await seeded();

    await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).look).toEqual({ notChecked: "The media container refused the video." });
    expect(askedForLook()).toBe(0);
  });

  it("throws when a look still cannot be deleted so the step is retried, and the retry leaves none", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    harness.failPointDeletes = 1;
    const { walkId, clips } = await seeded();

    await expect(checkCoverage(deps(), walkId, clips)).rejects.toThrow("R2 answered 503");
    await checkCoverage(deps(), walkId, clips);

    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("never records checked while light is not measured, even with every other measure met", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await seeded();

    await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).coverage).toBe("not_checked");
  });

  it("counts a pan gap when fewer than four pan tags arrived, and keeps it out of walk_gaps", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ pans: 2 });

    await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).gaps.map((g) => g.kind)).toEqual(["pans_missing"]);
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("leaves a not_checked gap another group wrote, and writes the same rows when it runs twice", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ legs: 2 });
    await env.DB.prepare("INSERT INTO walk_gaps (walk_id, side, kind, hint) VALUES (?, 'front', 'not_checked', 'again')").bind(walkId).run();

    await checkCoverage(deps(), walkId, clips);
    const first = await gapsForWalk(env.DB, walkId);
    await checkCoverage(deps(), walkId, clips);

    expect(await gapsForWalk(env.DB, walkId)).toEqual(first);
    expect(first.map((g) => `${g.side}:${g.kind}`)).toEqual(["front:not_checked", "right:missing", "back:missing"]);
  });
});

describe("samplesWithin", () => {
  const at = (t: number): MotionSample => ({ t, tiltDegrees: 10, headingDegrees: 0 });
  const samples = [0, 1, 2, 3, 4].map(at);

  it("keeps the samples from where a gap starts to where it ends, both ends included", () => {
    expect(samplesWithin(samples, { startSeconds: 1, endSeconds: 3 }).map((s) => s.t)).toEqual([1, 2, 3]);
  });

  it("keeps none for a gap with no place in the walk", () => {
    expect(samplesWithin(samples, null)).toEqual([]);
  });
});

describe("notCheckedConcepts", () => {
  const run = (concept: ConceptRun["concept"], outcome: ConceptRun["outcome"]): ConceptRun => ({
    concept,
    outcome,
    reason: outcome === "not_checked" ? "SAM answered 503" : null,
    framesBilled: 0,
  });

  it("lists each concept that was not checked once, across clips, and no other", () => {
    const loop = { runs: [run("wood_pile", "not_checked"), run("house_wall", "found")], tracks: [] };
    const pan = { runs: [run("wood_pile", "not_checked"), run("shrub", "none"), run("tree", "not_checked")], tracks: [] };

    expect(notCheckedConcepts([loop, pan])).toEqual(["wood_pile", "tree"]);
  });

  it("lists nothing when every concept was checked", () => {
    expect(notCheckedConcepts([{ runs: [run("shrub", "none")], tracks: [] }])).toEqual([]);
  });
});

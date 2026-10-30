import { addTag, type ConceptRun, gapsForWalk, saveClip, storeDetections, tagsForWalk } from "@emberwalk/db";
import { CoverageRecord, coverageKey } from "@emberwalk/rules";
import type { Clip, MotionSample, Tag, Track } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import sideWalk from "../../../fixtures/synthetic/side-walk/walk.json";
import { checkCoverage, notCheckedConcepts, samplesWithin, sideLight } from "../src/coverage-step.ts";
import { clipKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedWalk } from "./fixtures.ts";
import { harness, idFor, SAME_PLACE_PHRASE, stageSamePlace, stageSamePlaces, testDeps } from "./harness.ts";

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

type Options = { legs?: number; synthetic?: boolean; wallBottom?: number; pans?: number; loopTag?: boolean; sideTags?: number };

const seeded = async (options: Options = {}) => {
  const { legs = 4, synthetic = true, wallBottom = 0.8, pans = 4, loopTag = true, sideTags } = options;
  const walkId = freshWalkId();
  const n = Number(walkId.slice(-4));
  await seedWalk(walkId, { synthetic });
  const samples = circuit(legs);
  const seconds = samples.length;
  const clip: Clip = { id: idFor(2000 + n), walkId, kind: "loop", file: clipKey(walkId, "loop"), fps: FPS, frameCount: seconds * FPS, width: 320, height: 334 };
  await env.MEDIA.put(clip.file, new Uint8Array(32));
  await saveClip(env.DB, clip);
  if (sideTags !== undefined) {
    const leg = seconds / legs;
    for (const [i, side] of ["front", "left", "back", "right"].slice(0, legs).entries()) {
      const lit = samples.slice(i * leg, (i + 1) * leg).map((sample) => ({ ...sample, light: sideTags }));
      await addTag(env.DB, { id: idFor(3200 + n * 10 + i), walkId, kind: "loop", startSeconds: i * leg, endSeconds: (i + 1) * leg, label: side, samples: lit, propertyLine: null });
    }
  } else if (loopTag) {
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
    expect(outcome).toEqual({ coverage: "not_checked", loop: "closed", gaps: 0, sides: { front: "partly_checked", left: "partly_checked", back: "partly_checked", right: "partly_checked" } });
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

describe("the coverage step on a guided walk, which has no compass", () => {
  const SAME = { same: true, confidence: 0.9 };
  const DIFFERENT = { same: false, confidence: 0.9 };

  const guided = async (light = 150, tapSeconds = 24) => {
    const made = await seeded({ loopTag: false });
    const n = Number(made.walkId.slice(-4));
    for (const [i, side] of ["front", "left", "back", "right"].entries()) {
      const at = i * tapSeconds;
      await addTag(env.DB, {
        id: idFor(3800 + n * 10 + i),
        walkId: made.walkId,
        kind: "loop",
        startSeconds: at,
        endSeconds: at + tapSeconds,
        label: side,
        samples: [],
        light: [{ t: at + 1, light }],
        propertyLine: null,
      });
    }
    return made;
  };
  const threeStills = () => harness.stilled.filter((request) => request.stills.length === 3);
  const imagesOf = (body: unknown): string[] =>
    (body as { input: { content: { image_url?: string }[] }[] }).input.flatMap((m) => m.content.flatMap((c) => (c.image_url === undefined ? [] : [atob(c.image_url.slice(c.image_url.indexOf(",") + 1))])));
  const halfwayAsked = () => harness.requests.some((req) => req.path === "/responses" && "json" in req && imagesOf(req.json).some((image) => image.includes("/look/2.jpg")));

  it("closes the loop and reaches checked when the end looks like the start and the halfway point does not", async () => {
    stageSamePlaces(SAME, DIFFERENT);
    const { walkId, clips } = await guided();

    const outcome = await checkCoverage(deps(), walkId, clips);

    const record = await recordOf(walkId);
    expect(record).toMatchObject({ loop: "closed", coverage: "checked", gaps: [], look: { ...SAME, halfway: DIFFERENT } });
    expect(outcome).toEqual({ coverage: "checked", loop: "closed", gaps: 0, sides: { front: "checked", left: "checked", back: "checked", right: "checked" } });
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("cuts a third still at the halfway point, asks twice, and leaves no still in R2", async () => {
    stageSamePlaces(SAME, DIFFERENT);
    const { walkId, clips } = await guided();

    await checkCoverage(deps(), walkId, clips);

    expect(threeStills().map((request) => request.stills.map((s) => s.time))).toEqual([[2, 94, 48]]);
    expect(askedForLook()).toBe(2);
    expect(halfwayAsked()).toBe(true);
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("stays not checked when the halfway point looks like the start, and still stores the side gaps it finds", async () => {
    stageSamePlaces(SAME, { same: true, confidence: 0.95 });
    const { walkId, clips } = await guided(20);

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", coverage: "not_checked", look: { ...SAME, halfway: { same: true, confidence: 0.95 } } });
    expect(outcome.loop).toBe("not_checked");
    expect((await gapsForWalk(env.DB, walkId)).map((gap) => `${gap.side}:${gap.kind}`).sort()).toEqual(["back:dark", "front:dark", "left:dark", "right:dark"]);
  });

  it("is open and asks no halfway look when the end does not look like the start", async () => {
    stageSamePlaces(DIFFERENT, DIFFERENT);
    const { walkId, clips } = await guided();

    await checkCoverage(deps(), walkId, clips);

    const record = await recordOf(walkId);
    expect(record).toMatchObject({ loop: "open", coverage: "not_checked", look: DIFFERENT });
    expect(askedForLook()).toBe(1);
  });

  it("asks once and compares no halfway still when the end looks like the start at only 0.69", async () => {
    const UNSURE = { same: true, confidence: 0.69 };
    stageSamePlaces(UNSURE, DIFFERENT);
    const { walkId, clips } = await guided();

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(askedForLook()).toBe(1);
    expect(halfwayAsked()).toBe(false);
    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", coverage: "not_checked", look: UNSURE });
    expect((await recordOf(walkId)).look).not.toHaveProperty("halfway");
    expect(outcome.loop).toBe("not_checked");
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("keeps the end look and stays not checked when the halfway call still answers 500 after its retries", async () => {
    harness.answers[SAME_PLACE_PHRASE] = [{ text: JSON.stringify(SAME) }, { status: 500 }];
    const { walkId, clips } = await guided();

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(askedForLook()).toBe(4);
    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", coverage: "not_checked", look: { ...SAME, halfwayNotChecked: "Muse Spark answered 500" } });
    expect((await recordOf(walkId)).look).not.toHaveProperty("halfway");
    expect(outcome).toMatchObject({ loop: "not_checked", coverage: "not_checked" });
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("keeps the end look and stays not checked when the daily cap refuses the halfway call", async () => {
    stageSamePlaces(SAME, DIFFERENT);
    harness.onRequest = async (req) => {
      if (req.path === "/responses") harness.capUsd = 0.000001;
    };
    const { walkId, clips } = await guided();

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(askedForLook()).toBe(1);
    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", coverage: "not_checked", look: { ...SAME, halfwayNotChecked: expect.stringContaining("daily_cap_reached") } });
    expect((await recordOf(walkId)).look).not.toHaveProperty("halfway");
    expect(outcome).toMatchObject({ loop: "not_checked", coverage: "not_checked" });
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("keeps the end look and stays not checked when the halfway answer cannot be read, and leaves no still", async () => {
    stageSamePlaces(SAME, "not json at all");
    const { walkId, clips } = await guided();

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", coverage: "not_checked", look: { ...SAME, halfwayNotChecked: expect.stringContaining("refused") } });
    expect((await recordOf(walkId)).look).not.toHaveProperty("halfway");
    expect(outcome.loop).toBe("not_checked");
    expect(await lookKeys(walkId)).toEqual([]);
  });

  it("never closes on the side taps and corner pans alone: the end look must be asked and answered", async () => {
    stageSamePlaces("not json at all");
    const { walkId, clips } = await guided();

    await checkCoverage(deps(), walkId, clips);

    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", coverage: "not_checked", look: { notChecked: expect.any(String) } });
  });

  it("asks no halfway look and cuts two stills on a loop under 20 seconds", async () => {
    stageSamePlaces(SAME, DIFFERENT);
    const { walkId, clips } = await guided();
    const short: Clip = { ...(clips[0] as Clip), frameCount: 24 };

    await checkCoverage(deps(), walkId, [short]);

    expect(askedForLook()).toBe(1);
    expect(threeStills()).toEqual([]);
    expect(await recordOf(walkId)).toMatchObject({ loop: "not_checked", look: SAME });
  });

  it("asks no halfway look of a walk with a compass, which the compass closes", async () => {
    stageSamePlaces(SAME, DIFFERENT);
    const { walkId, clips } = await seeded();

    await checkCoverage(deps(), walkId, clips);

    expect(askedForLook()).toBe(1);
    expect(threeStills()).toEqual([]);
    expect((await recordOf(walkId)).look).toEqual(SAME);
  });
});

describe("the coverage step's corner gaps", () => {
  const pan = (walkId: string, i: number, label: string): Tag => ({
    id: idFor(3600 + Number(walkId.slice(-4)) * 10 + i),
    walkId,
    kind: "pan",
    startSeconds: 100 + i * 5,
    endSeconds: 102 + i * 5,
    label,
    samples: [],
    propertyLine: null,
  });
  const cornerGaps = async (walkId: string) => (await gapsForWalk(env.DB, walkId)).filter((gap) => gap.hint === "pan_corner");

  it("writes a missing gap with the pan_corner hint for each corner a side tagged walk never panned", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ sideTags: 150, pans: 0 });

    await checkCoverage(deps(), walkId, clips);

    expect(await cornerGaps(walkId)).toEqual(
      ["front_right", "back_right", "back_left", "front_left"].map((side) => ({ side, kind: "missing", hint: "pan_corner" })),
    );
  });

  it("writes no gap on the corner a walk of one corner panned", async () => {
    const walkId = freshWalkId();
    await seedWalk(walkId);
    await addTag(env.DB, pan(walkId, 0, "front right corner"));

    await checkCoverage(deps(), walkId, []);

    const gaps = await cornerGaps(walkId);
    expect(gaps.map((gap) => gap.side)).not.toContain("front_right");
    expect(gaps).toHaveLength(3);
  });

  it("counts a corner panned twice once, and writes no corner gap for a walk whose pans do not name corners", async () => {
    stageSamePlace({ same: true, confidence: 0.9 });
    const { walkId, clips } = await seeded({ sideTags: 150, pans: 0 });
    for (const [i, corner] of ["front left corner", "front left corner", "back left corner", "back right corner", "front right corner"].entries())
      await addTag(env.DB, pan(walkId, i, corner));
    await checkCoverage(deps(), walkId, clips);
    expect(await cornerGaps(walkId)).toEqual([]);

    const other = await seeded({ sideTags: 150, pans: 2 });
    await checkCoverage(deps(), other.walkId, other.clips);
    expect(await cornerGaps(other.walkId)).toEqual([]);
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


type SideWalkOptions = { light?: (kind: string, side: string, light: number) => number | undefined; panSides?: string[]; unchecked?: ConceptRun["concept"] };

const sideWalkSeeded = async ({ light = (_kind, _side, value) => value, panSides, unchecked }: SideWalkOptions = {}) => {
  const walkId = freshWalkId();
  const n = Number(walkId.slice(-4));
  await seedWalk(walkId, { synthetic: true });
  const pans = sideWalk.tags.filter((t) => t.kind === "pan");
  const tags: Tag[] = [...sideWalk.tags.filter((t) => t.kind === "loop"), ...pans.map((t, i) => ({ ...t, label: panSides?.[i] ?? t.label }))].map(
    (t, i) => ({
      ...t,
      id: idFor(5000 + n * 10 + i),
      walkId,
      kind: t.kind as Tag["kind"],
      samples: t.samples.map(({ light: seen, ...sample }) => {
        const kept = light(t.kind, t.label, seen);
        return kept === undefined ? sample : { ...sample, light: kept };
      }),
    }),
  );
  for (const tag of tags) await addTag(env.DB, tag);
  const loopEnd = Math.max(...tags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
  const clip: Clip = { id: idFor(2000 + n), walkId, kind: "loop", file: clipKey(walkId, "loop"), fps: FPS, frameCount: loopEnd * FPS, width: 320, height: 334 };
  await env.MEDIA.put(clip.file, new Uint8Array(32));
  await saveClip(env.DB, clip);
  const wall: Track = {
    id: idFor(4000 + n),
    clipId: clip.id,
    concept: "house_wall",
    samObjectId: 1,
    frames: Array.from({ length: Math.floor(loopEnd / 3) }, (_, i) => ({ frame: i * 3 * FPS, box: [0.1, 0.3, 0.9, 0.8], mask: null, confidence: 0.9 })),
  };
  const runs: ConceptRun[] = [{ concept: "house_wall", outcome: "found", reason: null, framesBilled: clip.frameCount }];
  if (unchecked !== undefined) runs.push({ concept: unchecked, outcome: "not_checked", reason: "SAM answered 503", framesBilled: 0 });
  await storeDetections(env.DB, { clipId: clip.id, runs, tracks: [wall] });
  return { walkId, clips: [clip] };
};

const ALL_CHECKED = { front: "checked", left: "checked", back: "checked", right: "checked" };
const ALL_PARTLY = { front: "partly_checked", left: "partly_checked", back: "partly_checked", right: "partly_checked" };

describe('the walk went all the way around the house, on the synthetic side walk as the phone tags it', () => {
  it("a walk all the way around with four corner pans, the same place on its return and a good wall base reaches coverage checked", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await seeded({ sideTags: 150 });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).coverage).toBe("checked");
    expect(outcome.coverage).toBe("checked");
  });

  it("holds green on the same walk when every side is too dark", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await seeded({ sideTags: 10 });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome).toMatchObject({ coverage: "not_checked", gaps: 4 });
    expect((await gapsForWalk(env.DB, walkId)).map((g) => g.hint)).toEqual(["more_light", "more_light", "more_light", "more_light"]);
  });

  it("a walk with every side tagged and enough light reaches checked (green), every side checked, no gap kept", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded();

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome).toEqual({ coverage: "checked", loop: "closed", gaps: 0, sides: ALL_CHECKED });
    expect(await recordOf(walkId)).toMatchObject({ coverage: "checked", loop: "closed", gaps: [], sides: ALL_CHECKED });
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("marks a side too dark partly checked, keeps a dark gap for it alone with the more light hint, and holds green", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ light: (kind, side, value) => (kind === "loop" && side === "back" ? 20 : value) });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome).toEqual({ coverage: "not_checked", loop: "closed", gaps: 1, sides: { ...ALL_CHECKED, back: "partly_checked" } });
    const record = await recordOf(walkId);
    expect(record.sides).toEqual(outcome.sides);
    expect(record.gaps).toEqual([expect.objectContaining({ kind: "dark", side: "back", reason: { measure: "light", measured: 20, needed: 40 } })]);
    expect(await gapsForWalk(env.DB, walkId)).toEqual([{ side: "back", kind: "dark", hint: "more_light" }]);
  });

  it("reads the light of each side from the samples of that side's loop tags, never from its pan", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ light: (kind, _side, value) => (kind === "pan" ? 5 : value) });
    const tags = await tagsForWalk(env.DB, walkId);
    const mean = (kind: string, side: string) => {
      const seen = tags.filter((t) => t.kind === kind && t.label === side).flatMap((t) => t.samples.map((s) => s.light ?? Number.NaN));
      return seen.reduce((sum, value) => sum + value, 0) / seen.length;
    };
    expect(mean("pan", "back left corner")).toBe(5);
    expect(sideLight(tags)).toEqual({ front: mean("loop", "front"), left: mean("loop", "left"), back: mean("loop", "back"), right: mean("loop", "right") });
    expect(sideLight(tags).front).toBe(150);
    expect((await checkCoverage(deps(), walkId, clips)).coverage).toBe("checked");
  });

  it("reads the light of a guided walk's side from the readings on its loop tags, with no compass samples, and never from a pan", () => {
    const loop = (label: string, light?: { t: number; light: number }[]): Tag => ({
      id: idFor(1),
      walkId: freshWalkId(),
      kind: "loop",
      startSeconds: 0,
      endSeconds: 10,
      label,
      samples: [],
      propertyLine: null,
      ...(light === undefined ? {} : { light }),
    });
    const pan: Tag = { ...loop("front left corner", [{ t: 1, light: 255 }]), kind: "pan" };
    const read = sideLight([
      loop("front", [{ t: 1, light: 100 }, { t: 2, light: 200 }]),
      loop("front", [{ t: 11, light: 150 }]),
      loop("left", [{ t: 1, light: 20 }]),
      loop("back"),
      pan,
    ]);
    expect(read).toEqual({ front: 150, left: 20, back: null, right: null });
  });

  it("holds green and marks a side partly checked when that side's light was never measured, as from a phone before light", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ light: (kind, side, value) => (kind === "loop" && side === "right" ? undefined : value) });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome).toEqual({ coverage: "not_checked", loop: "closed", gaps: 0, sides: { ...ALL_CHECKED, right: "partly_checked" } });
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("counts a side panned twice as one pan, so four pans of two sides still miss the pans", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ panSides: ["front", "front", "back", "back"] });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome.coverage).toBe("not_checked");
    expect((await recordOf(walkId)).gaps).toEqual([expect.objectContaining({ kind: "pans_missing", reason: { measure: "pans", measured: 2, needed: 4 } })]);
    expect(outcome.sides).toEqual(ALL_PARTLY);
  });

  it("counts a corner panned twice as one pan, so four pans of three corners still miss the pans", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ panSides: ["front left corner", "back left corner", "back left corner", "back right corner"] });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome.coverage).toBe("not_checked");
    expect((await recordOf(walkId)).gaps).toEqual([expect.objectContaining({ kind: "pans_missing", reason: { measure: "pans", measured: 3, needed: 4 } })]);
  });

  it("counts four pans of the four corners as every pan", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ panSides: ["front left corner", "back left corner", "back right corner", "front right corner"] });

    await checkCoverage(deps(), walkId, clips);

    expect((await recordOf(walkId)).gaps).toEqual([]);
  });

  it("marks no side checked when the loop did not come back to its start", async () => {
    stageSamePlace({ same: false, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded();

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome).toMatchObject({ coverage: "not_checked", loop: "open", sides: ALL_PARTLY });
  });

  it("marks no side checked while a concept on the walk could not be checked", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await sideWalkSeeded({ unchecked: "wood_pile" });

    const outcome = await checkCoverage(deps(), walkId, clips);

    expect(outcome).toEqual({ coverage: "not_checked", loop: "closed", gaps: 0, sides: ALL_PARTLY });
  });

  it("marks a side the walk never reached not checked", async () => {
    stageSamePlace({ same: true, confidence: 0.99 });
    const { walkId, clips } = await seeded({ legs: 2 });
    const outcome = await checkCoverage(deps(), walkId, clips);
    expect(outcome.sides).toMatchObject({ back: "not_checked", right: "not_checked" });
  });
});

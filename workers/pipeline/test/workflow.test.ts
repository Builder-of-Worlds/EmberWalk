import { CATALOG, samPhraseOf } from "@emberwalk/catalog";
import { addTag, clipsForWalk, detectionsForClip, findingsForWalk, gapsForWalk, getWalk } from "@emberwalk/db";
import { LOOP_CONCEPTS, OBJECT_CONCEPTS, PAN_CONCEPTS, type Tag } from "@emberwalk/shared";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PRIVACY_PHRASES, type PrivacyRecord, privacyKey } from "../src/privacy.ts";
import { lookingSteps, orderProblems, STEP, WRITING_STEPS } from "../src/steps.ts";
import { CoverageRecord, coverageKey } from "@emberwalk/rules";
import guidedWalk from "../../../apps/web/test/unit/guided-walk.json";
import sideWalk from "../../../fixtures/synthetic/side-walk/walk.json";
import { clipKey, detectionsKey, originalKey } from "../src/storage.ts";
import { CLEAN_PHRASE } from "../src/voice-notes.ts";
import { freshWalkId, resetAll, seedOriginal, seedTag, seedWalk, spentNano } from "./fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, harness, idFor, type Sighting, stageSamePlace, stageSamePlaces } from "./harness.ts";

beforeEach(resetAll);

const run = async (walkId: string, finish: "complete" | "errored" = "complete") => {
  const instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PIPELINE.create({ id: walkId, params: { walkId } });
  await instance.waitForStatus(finish);
  return instance;
};

const queuedWalk = async (options: { synthetic?: boolean } = {}): Promise<string> => {
  const walkId = freshWalkId();
  await seedWalk(walkId, options);
  await seedOriginal(walkId);
  return walkId;
};

const deleted = () => harness.requests.filter((r) => r.method === "DELETE").map((r) => r.path);

describe("the walk workflow", () => {
  it("cuts, uploads and segments a loop clip and a pan clip, then deletes the uploads", async () => {
    const walkId = await queuedWalk();
    await seedTag(walkId, 1, "loop", 10, 40);
    await seedTag(walkId, 2, "pan", 50, 80);
    harness.answers["wood pile"] = [{ found: [{ frame: 0, id: 0, box: [10, 20, 110, 120], confidence: 0.9 }] }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const clips = await clipsForWalk(env.DB, walkId);
    expect(clips.map((c) => c.kind)).toEqual(["loop", "pan"]);
    for (const clip of clips) {
      expect(await env.MEDIA.head(detectionsKey(walkId, clip.id))).not.toBeNull();
      const stored = await detectionsForClip(env.DB, clip.id);
      expect(stored.tracks.map((t) => t.concept)).toEqual(["wood_pile"]);
      expect(stored.runs.length).toBe(clip.kind === "loop" ? LOOP_CONCEPTS.length : PAN_CONCEPTS.length);
    }
    expect(deleted().sort()).toEqual(["/files/file-1", "/files/file-2"]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
  });

  it("asks SAM for each of the ten yard objects on both clips of a walk, and for the wood deck on the loop only", async () => {
    const walkId = await queuedWalk();
    await seedTag(walkId, 1, "loop", 10, 40);
    await seedTag(walkId, 2, "pan", 50, 80);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const objects = CATALOG.filter((row) => (OBJECT_CONCEPTS as readonly string[]).includes(row.concept));
    expect(objects).toHaveLength(10);
    for (const row of objects) expect(harness.asked.filter((p) => p === samPhraseOf(row)), row.concept).toHaveLength(2);
    expect(harness.asked.filter((p) => p === "wooden deck")).toHaveLength(1);
  });

  it("fails the walk when the store step cannot read what segmenting left", async () => {
    const walkId = await queuedWalk();
    harness.hideDetections = true;

    await using instance = await run(walkId, "errored");

    expect((await instance.getError()).message).toContain("missing");
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toMatchObject({ name: "failed", step: "segment" });
    expect(walk?.failure).toMatchObject({ code: "segment_failed" });
    expect(deleted()).toEqual(["/files/file-1"]);
  });

  it("skips a walk that is not queued and sends nothing", async () => {
    const walkId = freshWalkId();
    await seedWalk(walkId, { state: "done" });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "skipped" });
    expect(harness.probed).toHaveLength(0);
    expect((await getWalk(env.DB, walkId))?.state.name).toBe("done");
  });

  it("ends failed with a plain reason when the video is refused", async () => {
    const walkId = await queuedWalk();
    harness.probe = { bytes: 1, durationSeconds: 30, isMp4: false };

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "not_mp4" } });
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toMatchObject({ name: "failed", step: "prepare" });
    expect(walk?.failure?.code).toBe("not_mp4");
    expect(harness.requests).toHaveLength(0);
  });

  it("ends failed, and still deletes the upload, when the spending cap stops SAM", async () => {
    const walkId = await queuedWalk();
    harness.capUsd = 0.001;

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "spend_limit" } });
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toMatchObject({ name: "failed", step: "segment" });
    expect(deleted()).toEqual(["/files/file-1"]);
  });

  it("ends failed when real footage is not allowed", async () => {
    const walkId = await queuedWalk({ synthetic: false });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "real_footage_not_allowed" } });
    expect(harness.requests.filter((r) => r.path === "/responses")).toHaveLength(0);
  });

  it("retries a failing step, then errors the instance and fails the walk", async () => {
    const walkId = await queuedWalk();
    harness.probe = { throws: "the media container answered 503" };

    await using instance = await run(walkId, "errored");

    expect((await instance.getError()).message).toContain("503");
    expect(harness.probed).toHaveLength(4);
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toMatchObject({ name: "failed", step: "prepare" });
    expect(walk?.failure).toMatchObject({ code: "prepare_failed" });
  });

  it("recovers when a step fails once and then works", async () => {
    const walkId = await queuedWalk();
    harness.probeFailures = 2;

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(harness.probed).toHaveLength(3);
    expect(await clipsForWalk(env.DB, walkId)).toHaveLength(1);
  });
});

type Box = [number, number, number, number];

const seen = (id: number, [l, t, r, b]: Box, frames = [0, 1, 2]): Sighting[] =>
  frames.map((frame) => ({
    frame,
    id,
    box: [Math.round(l * FRAME_WIDTH), Math.round(t * FRAME_HEIGHT), Math.round(r * FRAME_WIDTH), Math.round(b * FRAME_HEIGHT)],
    confidence: 0.9,
  }));

const foundWalk = async (kinds: ("loop" | "pan")[] = ["loop", "pan"], options: { people?: boolean } = {}): Promise<string> => {
  const walkId = await queuedWalk();
  harness.clip = { frames: 10, fps: 2, width: 1280, height: 720 };
  for (const [i, kind] of kinds.entries()) {
    const start = i * 10;
    const samples = Array.from({ length: 11 }, (_, k) => ({ t: start + k * 0.5, tiltDegrees: 25, headingDegrees: 0 }));
    await addTag(env.DB, { id: idFor(7100 + i), walkId, kind, startSeconds: start, endSeconds: start + 5, label: "front left corner", samples, propertyLine: null });
  }
  harness.answers["house wall"] = [{ found: seen(0, [0.05, 0.2, 0.95, 0.6]) }];
  harness.answers["wood pile"] = [{ found: seen(1, [0.2, 0.45, 0.4, 0.6]) }];
  if (options.people !== false) harness.answers.person = [{ found: seen(2, [0.0, 0.0, 0.1, 0.1]) }];
  return walkId;
};

const privacyOf = async (walkId: string, clipId: string): Promise<PrivacyRecord> => (await (await env.MEDIA.get(privacyKey(walkId, clipId)))!.json()) as PrivacyRecord;

const proofStills = () => harness.stilled.filter((r) => r.input.includes("/originals/"));

const explainCalls = () => harness.requests.filter((r) => r.path === "/responses" && "json" in r && JSON.stringify(r.json).includes("RULE TABLE"));

const videoLeft = async (walkId: string) =>
  (await Promise.all([originalKey(walkId), clipKey(walkId, "loop"), clipKey(walkId, "pan")].map((key) => env.MEDIA.head(key)))).filter((o) => o !== null);

describe("privacy, blur and explain", () => {
  it("checks privacy on each clip before its upload is deleted, blurs each clip's proof stills with its privacy regions, explains once and ends done with the video gone", async () => {
    const walkId = await foundWalk();

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(orderProblems(harness.steps, ["loop", "pan"])).toEqual([]);
    for (const phrase of PRIVACY_PHRASES) expect(harness.asked.filter((p) => p === phrase)).toHaveLength(2);
    const findings = await findingsForWalk(env.DB, walkId);
    expect(findings.length).toBeGreaterThan(0);
    const proofClips = new Set(findings.map((f) => f.proofFrame.clipId));
    expect(proofStills()).toHaveLength(proofClips.size);
    for (const f of findings) {
      const still = proofStills().flatMap((r) => r.stills).find((s) => s.output.includes(f.proofFrame.still));
      const record = await privacyOf(walkId, f.proofFrame.clipId);
      const regions = record.frames.find((r) => r.frame === f.proofFrame.frame)?.regions;
      expect(regions?.length).toBeGreaterThan(0);
      expect(still?.regions).toEqual(regions);
      expect(await env.MEDIA.head(f.proofFrame.still)).not.toBeNull();
    }
    expect(explainCalls().length).toBeGreaterThan(0);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
    expect(await videoLeft(walkId)).toEqual([]);
  });

  it("blurs nothing and skips explain for a walk with no findings, and still ends done", async () => {
    const walkId = await queuedWalk();
    await seedTag(walkId, 1, "loop", 10, 40);
    harness.answers["wood pile"] = [{ found: [{ frame: 0, id: 0, box: [10, 20, 110, 120], confidence: 0.9 }] }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await findingsForWalk(env.DB, walkId)).toEqual([]);
    expect(proofStills()).toEqual([]);
    expect(harness.steps).toContain(STEP.blur);
    expect(harness.steps).not.toContain(STEP.explain);
    expect(explainCalls()).toEqual([]);
  });

  it("still makes a clip's proof stills when the privacy check found nothing to blur", async () => {
    const walkId = await foundWalk(["loop"], { people: false });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const stills = proofStills().flatMap((r) => r.stills);
    expect(stills.length).toBeGreaterThan(0);
    for (const still of stills) expect(still.regions).toEqual([]);
  });

  it("fails at segment when the privacy phrases are refused, makes no still and deletes the video", async () => {
    const first = await queuedWalk();
    await seedTag(first, 1, "loop", 10, 40);
    await using measured = await run(first);
    expect(await measured.getOutput()).toEqual({ status: "done" });
    const perCall = (await spentNano()) / harness.asked.length;
    harness.asked = [];
    harness.capUsd = ((await spentNano()) + LOOP_CONCEPTS.length * perCall + perCall / 2) / 1e9;

    const walkId = await foundWalk(["loop"]);
    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "spend_limit" } });
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ name: "failed", step: "segment" });
    expect(harness.steps).toContain(STEP.privacy("loop"));
    expect(harness.asked.filter((p) => (PRIVACY_PHRASES as readonly string[]).includes(p))).toEqual([]);
    expect(proofStills()).toEqual([]);
    expect(await videoLeft(walkId)).toEqual([]);
  });

  it("fails at score when a privacy phrase could not be checked, and stores no still", async () => {
    const walkId = await foundWalk(["loop"]);
    harness.answers.mailbox = [{ status: 500 }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "privacy_not_checked" } });
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ name: "failed", step: "score" });
    expect(proofStills()).toEqual([]);
    for (const f of await findingsForWalk(env.DB, walkId)) expect(await env.MEDIA.head(f.proofFrame.still)).toBeNull();
    expect(harness.steps).not.toContain(STEP.complete);
    expect(await videoLeft(walkId)).toEqual([]);
  });

  it("saves the template wording and ends done when the explainer gives no usable answer", async () => {
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(explainCalls().length).toBeGreaterThan(0);
    const findings = await findingsForWalk(env.DB, walkId);
    expect(findings.length).toBeGreaterThan(0);
    for (const f of findings) expect(f.instruction.length).toBeGreaterThan(0);
    expect(harness.steps.indexOf(STEP.complete)).toBeGreaterThan(harness.steps.indexOf(STEP.explain));
  });

  it.each(["throws", "times out"] as const)("ends the walk done when the second check and the preview each %s", async (how) => {
    const walkId = await foundWalk(["loop"]);
    await using instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      for (const name of [STEP.secondCheck, STEP.preview]) {
        if (how === "throws") await m.mockStepError({ name }, new Error(`${name} broke`));
        else await m.forceStepTimeout({ name });
      }
    });
    await env.PIPELINE.create({ id: walkId, params: { walkId } });
    await instance.waitForStatus("complete");

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const walk = await getWalk(env.DB, walkId);
    expect(walk?.state).toEqual({ name: "done" });
    expect(walk?.failure).toBeNull();
  });

  const edits = () => harness.requests.filter((r) => r.path === "/images/edits");

  it("asks Muse Image for previews on a walk with findings", async () => {
    await using instance = await run(await foundWalk(["loop"]));
    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(edits().length).toBeGreaterThan(0);
  });

  it("tries a failed preview step once and never again, so no edit is paid for twice", async () => {
    const walkId = await foundWalk(["loop"]);
    await using instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
    await instance.modify(async (m) => {
      await m.disableRetryDelays();
      await m.mockStepError({ name: STEP.preview }, new Error("preview broke"), 1);
    });
    await env.PIPELINE.create({ id: walkId, params: { walkId } });
    await instance.waitForStatus("complete");

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(edits()).toEqual([]);
  });
});

describe("coverage", () => {
  it("runs after blur, before explain and before the video is deleted, and its record outlives the video", async () => {
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const at = (name: string) => harness.steps.indexOf(name);
    expect(at(STEP.coverage)).toBeGreaterThan(at(STEP.blur));
    expect(at(STEP.coverage)).toBeLessThan(at(STEP.enterExplain));
    expect(at(STEP.coverage)).toBeLessThan(at(STEP.deleteVideo));
    expect(await env.MEDIA.head(coverageKey(walkId))).not.toBeNull();
    expect(await videoLeft(walkId)).toEqual([]);
  });

  it("a walk tagged on every side with enough light, the same place on its return and a good wall base reaches coverage checked through the whole workflow", async () => {
    const walkId = await queuedWalk();
    for (const [i, tag] of sideWalk.tags.entries()) await addTag(env.DB, { ...tag, kind: tag.kind as Tag["kind"], id: idFor(7300 + i), walkId });
    const loopSeconds = Math.max(...sideWalk.tags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
    harness.clip = { frames: loopSeconds * 2, fps: 2, width: FRAME_WIDTH, height: FRAME_HEIGHT };
    harness.answers["house wall"] = [{ found: seen(0, [0.1, 0.3, 0.9, 0.8], Array.from({ length: Math.floor(loopSeconds / 3) }, (_, i) => i * 6)) }];
    stageSamePlace({ same: true, confidence: 0.99 });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const record = CoverageRecord.parse(await (await env.MEDIA.get(coverageKey(walkId)))!.json());
    expect(record).toMatchObject({ coverage: "checked", loop: "closed", gaps: [], sides: { front: "checked", left: "checked", back: "checked", right: "checked" } });
    expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
  });

  it("a guided walk with motion refused and its left side tapped through stores the left side's gap alone, through the whole workflow", async () => {
    const walkId = await queuedWalk();
    for (const [i, tag] of guidedWalk.tags.entries()) await addTag(env.DB, { ...tag, kind: tag.kind as Tag["kind"], id: idFor(7400 + i), walkId });
    const loopSeconds = Math.max(...guidedWalk.tags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
    harness.clip = { frames: loopSeconds * 2, fps: 2, width: FRAME_WIDTH, height: FRAME_HEIGHT };
    harness.answers["house wall"] = [{ found: seen(0, [0.1, 0.3, 0.9, 0.8], Array.from({ length: Math.floor(loopSeconds / 3) + 1 }, (_, i) => i * 6)) }];
    stageSamePlace({ same: true, confidence: 0.99 });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await gapsForWalk(env.DB, walkId)).toEqual(guidedWalk.gaps);
    const record = CoverageRecord.parse(await (await env.MEDIA.get(coverageKey(walkId)))!.json());
    expect(record).toMatchObject({ coverage: "not_checked", sides: { front: "partly_checked", left: "not_checked", back: "partly_checked", right: "partly_checked" } });
    expect(record.gaps.filter((gap) => gap.side !== null)).toEqual([
      { kind: "missing", side: "left", where: { startSeconds: 12, endSeconds: 14 }, reason: { measure: "seconds", measured: 2, needed: 5 } },
    ]);
  });

  it("a guided walk that panned three corners stores the fourth corner's gap alone, through the whole workflow", async () => {
    const { tags, gaps } = guidedWalk.missedCorner;
    const walkId = await queuedWalk();
    for (const [i, tag] of tags.entries()) await addTag(env.DB, { ...tag, kind: tag.kind as Tag["kind"], id: idFor(7500 + i), walkId });
    const loopSeconds = Math.max(...tags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
    harness.clip = { frames: loopSeconds * 2, fps: 2, width: FRAME_WIDTH, height: FRAME_HEIGHT };
    harness.answers["house wall"] = [{ found: seen(0, [0.1, 0.3, 0.9, 0.8], Array.from({ length: Math.floor(loopSeconds / 3) + 1 }, (_, i) => i * 6)) }];
    stageSamePlace({ same: true, confidence: 0.99 });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await gapsForWalk(env.DB, walkId)).toEqual(gaps);
  });

  it("a guided walk whose tags carry light readings and no compass stores a dark gap for the side read below the dark line and none for a lit side, through the whole workflow", async () => {
    const { tags, gaps } = guidedWalk.lit;
    const walkId = await queuedWalk();
    for (const [i, tag] of tags.entries()) await addTag(env.DB, { ...tag, kind: tag.kind as Tag["kind"], id: idFor(7600 + i), walkId });
    const loopSeconds = Math.max(...tags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
    harness.clip = { frames: loopSeconds * 2, fps: 2, width: FRAME_WIDTH, height: FRAME_HEIGHT };
    harness.answers["house wall"] = [{ found: seen(0, [0.1, 0.3, 0.9, 0.8], Array.from({ length: Math.floor(loopSeconds / 3) + 1 }, (_, i) => i * 6)) }];
    stageSamePlace({ same: true, confidence: 0.99 });

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await gapsForWalk(env.DB, walkId)).toEqual(gaps);
    const record = CoverageRecord.parse(await (await env.MEDIA.get(coverageKey(walkId)))!.json());
    expect(record.gaps.filter((gap) => gap.side !== null)).toEqual([
      expect.objectContaining({ kind: "dark", side: "right", reason: { measure: "light", measured: 20, needed: 40 } }),
    ]);
    expect(record.sides).toMatchObject({ front: "partly_checked", left: "partly_checked", back: "partly_checked", right: "partly_checked" });
  });

  describe("the guided walk's loop closure from the video", () => {
    const litTags = guidedWalk.lit.tags.map((tag) => ({
      ...tag,
      kind: tag.kind as Tag["kind"],
      light: tag.light.map((reading) => ({ ...reading, light: reading.light === 20 ? 150 : reading.light })),
    }));
    const guidedRun = async (...answers: Parameters<typeof stageSamePlaces>) => {
      const walkId = await queuedWalk();
      for (const [i, tag] of litTags.entries()) await addTag(env.DB, { ...tag, id: idFor(7700 + i), walkId });
      const loopSeconds = Math.max(...litTags.filter((t) => t.kind === "loop").map((t) => t.endSeconds));
      harness.clip = { frames: loopSeconds * 2, fps: 2, width: FRAME_WIDTH, height: FRAME_HEIGHT };
      harness.answers["house wall"] = [{ found: seen(0, [0.1, 0.3, 0.9, 0.8], Array.from({ length: Math.floor(loopSeconds / 3) + 1 }, (_, i) => i * 6)) }];
      stageSamePlaces(...answers);
      await using instance = await run(walkId);
      expect(await instance.getOutput()).toEqual({ status: "done" });
      return { walkId, record: CoverageRecord.parse(await (await env.MEDIA.get(coverageKey(walkId)))!.json()) };
    };

    it("closes a guided walk whose end looks like its start and whose halfway point does not, and with every other check met it reaches checked", async () => {
      const { walkId, record } = await guidedRun({ same: true, confidence: 0.95 }, { same: false, confidence: 0.95 });

      expect(record).toMatchObject({
        coverage: "checked",
        loop: "closed",
        gaps: [],
        look: { same: true, confidence: 0.95, halfway: { same: false, confidence: 0.95 } },
        sides: { front: "checked", left: "checked", back: "checked", right: "checked" },
      });
      expect(await gapsForWalk(env.DB, walkId)).toEqual([]);
    });

    it("leaves a guided walk not checked, with its loop not checked, when the halfway point looks like the start", async () => {
      const { record } = await guidedRun({ same: true, confidence: 0.95 }, { same: true, confidence: 0.95 });

      expect(record).toMatchObject({ coverage: "not_checked", loop: "not_checked", gaps: [] });
    });

    it("calls a guided walk open when its end does not look like its start", async () => {
      const { record } = await guidedRun({ same: false, confidence: 0.95 });

      expect(record).toMatchObject({ coverage: "not_checked", loop: "open" });
      expect(record.gaps.map((gap) => gap.kind)).toEqual(["loop_open"]);
    });
  });

  it("ends done with the look recorded as not checked when Muse Spark gives no usable answer", async () => {
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const record = (await (await env.MEDIA.get(coverageKey(walkId)))!.json()) as { look: unknown; coverage: string };
    expect(record.look).toEqual({ notChecked: expect.any(String) });
    expect(record.coverage).toBe("not_checked");
  });
});

describe("voice notes", () => {
  const originalsLeft = async (walkId: string) => (await env.MEDIA.list({ prefix: `originals/${walkId}/` })).objects.map((o) => o.key);
  const sparkBodies = () => harness.requests.flatMap((r) => (r.path === "/responses" && "json" in r ? [JSON.stringify(r.json)] : []));
  const explainBody = () => sparkBodies().find((b) => !b.includes(CLEAN_PHRASE) && b.includes("woodpile"));
  const CLEANED = "This woodpile is right up against the garage wall, and the juniper by the porch has a lot of dead branches inside.";

  it("with the flag on, puts the cleaned words on the finding, gives the raw turns to the explainer and leaves nothing under originals/", async () => {
    harness.voiceNotes = true;
    harness.answers[CLEAN_PHRASE] = [{ text: JSON.stringify({ notes: [{ id: "1", text: CLEANED }] }) }];
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(orderProblems(harness.steps, ["loop"])).toEqual([]);
    const notes = (await findingsForWalk(env.DB, walkId)).map((f) => f.voiceNote).filter((n) => n !== null);
    expect(notes).toEqual([CLEANED]);
    expect(explainBody()).toContain("The juniper by the porch has a lot of dead branches inside.");
    expect(await originalsLeft(walkId)).toEqual([]);
    expect(await videoLeft(walkId)).toEqual([]);
  });

  it("stores the raw joined words when cleaning gives no usable answer", async () => {
    harness.voiceNotes = true;
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const notes = (await findingsForWalk(env.DB, walkId)).map((f) => f.voiceNote).filter((n) => n !== null);
    expect(notes).toEqual(["This woodpile is right up against the garage wall."]);
  });

  it("with the flag off, runs both steps with no audio or Meta call and stores no note", async () => {
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(orderProblems(harness.steps, ["loop"])).toEqual([]);
    expect(harness.audioed).toHaveLength(0);
    expect(harness.requests.filter((r) => r.path === "/asr/transcribe")).toHaveLength(0);
    expect(sparkBodies().filter((b) => b.includes(CLEAN_PHRASE))).toHaveLength(0);
    expect((await findingsForWalk(env.DB, walkId)).every((f) => f.voiceNote === null)).toBe(true);
  });

  it("ends done with no note for a walk recorded with sound off", async () => {
    harness.voiceNotes = true;
    harness.audio = { refuse: { code: "media_no_audio", message: "The input has no sound." } };
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(harness.requests.filter((r) => r.path === "/asr/transcribe")).toHaveLength(0);
    expect((await findingsForWalk(env.DB, walkId)).every((f) => f.voiceNote === null)).toBe(true);
    expect(await originalsLeft(walkId)).toEqual([]);
  });

  it("ends done with no note when the Transcribe answer is off its shape", async () => {
    harness.voiceNotes = true;
    harness.transcribed = { words: "no turns here" };
    const walkId = await foundWalk(["loop"]);

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect((await findingsForWalk(env.DB, walkId)).every((f) => f.voiceNote === null)).toBe(true);
  });
});

describe("the stage count", () => {
  const counted = async (instance: Awaited<ReturnType<typeof run>>, names: readonly string[]) =>
    Promise.all(names.map((name) => instance.waitForStepResult({ name: STEP.count(name) })));
  const rising = (total: number) => Array.from({ length: total }, (_, i) => ({ done: i + 1, total }));

  it("counts a two clip walk up to the total of each stage, in order, then clears it at done", async () => {
    const walkId = await foundWalk();

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await counted(instance, lookingSteps(["loop", "pan"]))).toEqual(rising(14));
    expect(await counted(instance, WRITING_STEPS)).toEqual(rising(4));
    expect(orderProblems(harness.steps, ["loop", "pan"])).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
  });

  it("stores each count in D1 as the walk goes, so the second clip's upload finds the count of the step before it", async () => {
    const walkId = await foundWalk();
    const stored: unknown[] = [];
    harness.onRequest = async (req) => {
      if (req.method === "POST" && req.path === "/files") stored.push((await getWalk(env.DB, walkId))?.state);
    };

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const looking = lookingSteps(["loop", "pan"]);
    const before = looking.indexOf(STEP.upload("pan"));
    expect(stored[1]).toEqual({ name: "processing", step: "segment", progress: { done: before, total: looking.length } });
  });

  it("counts no writing for a walk with nothing found", async () => {
    const walkId = await queuedWalk();
    await seedTag(walkId, 1, "loop", 10, 40);
    harness.answers["wood pile"] = [{ found: [{ frame: 0, id: 0, box: [10, 20, 110, 120], confidence: 0.9 }] }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    expect(await findingsForWalk(env.DB, walkId)).toEqual([]);
    expect(await counted(instance, lookingSteps(["loop"]))).toEqual(rising(11));
    expect(harness.steps.filter((name) => WRITING_STEPS.map(STEP.count).includes(name))).toEqual([]);
  });

  it("adds no count for a step that failed or never ran, and the walk shows failed with no count", async () => {
    const walkId = await foundWalk(["loop"]);
    harness.answers.mailbox = [{ status: 500 }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "privacy_not_checked" } });
    const looking = lookingSteps(["loop"]);
    const before = looking.slice(0, looking.indexOf(STEP.blur));
    expect(harness.steps.filter((name) => name.startsWith("count "))).toEqual(before.map(STEP.count));
    expect(await counted(instance, before)).toEqual(rising(11).slice(0, before.length));
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "failed", step: "score" });
  });
});

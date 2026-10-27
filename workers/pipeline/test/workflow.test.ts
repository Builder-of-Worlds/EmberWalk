import { addTag, clipsForWalk, detectionsForClip, findingsForWalk, getWalk } from "@emberwalk/db";
import { LOOP_CONCEPTS, PAN_CONCEPTS } from "@emberwalk/shared";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { PRIVACY_PHRASES, type PrivacyRecord, privacyKey } from "../src/privacy.ts";
import { orderProblems, STEP } from "../src/steps.ts";
import { clipKey, detectionsKey, originalKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedOriginal, seedTag, seedWalk, spentNano } from "./fixtures.ts";
import { FRAME_HEIGHT, FRAME_WIDTH, harness, idFor, type Sighting } from "./harness.ts";

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
});

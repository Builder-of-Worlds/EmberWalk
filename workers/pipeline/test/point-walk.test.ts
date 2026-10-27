import { clipsForWalk, detectionsForClip, getWalk } from "@emberwalk/db";
import { LOOP_CONCEPTS, PAN_CONCEPTS } from "@emberwalk/shared";
import { env, introspectWorkflowInstance } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { asking, BRUSH, FENCE, FPS, framesOf, FRAMES, HEIGHT, stageRecorded, WIDTH } from "./recorded.ts";
import { freshWalkId, resetAll, seedOriginal, seedTag, seedWalk } from "./fixtures.ts";
import { harness } from "./harness.ts";

beforeEach(async () => {
  await resetAll();
  harness.clip = { frames: FRAMES, fps: FPS, width: WIDTH, height: HEIGHT };
});

const run = async (walkId: string) => {
  const instance = await introspectWorkflowInstance(env.PIPELINE, walkId);
  await instance.modify(async (m) => {
    await m.disableRetryDelays();
  });
  await env.PIPELINE.create({ id: walkId, params: { walkId } });
  await instance.waitForStatus("complete");
  return instance;
};

const walkWithBothClips = async (options: { synthetic?: boolean } = {}): Promise<string> => {
  const walkId = freshWalkId();
  await seedWalk(walkId, options);
  await seedOriginal(walkId);
  await seedTag(walkId, 1, "loop", 10, 40);
  await seedTag(walkId, 2, "pan", 50, 80);
  return walkId;
};

const deleted = () => harness.requests.filter((r) => r.method === "DELETE").map((r) => r.path);

describe("a walk whose dry brush and fence are pointed at", () => {
  it("stores the dry brush and the fence tracks from the recorded answers", async () => {
    const walkId = await walkWithBothClips();
    stageRecorded();

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const [loop, pan] = await clipsForWalk(env.DB, walkId);
    const onLoop = await detectionsForClip(env.DB, loop!.id);
    const onPan = await detectionsForClip(env.DB, pan!.id);
    expect(onLoop.tracks.map((t) => [t.concept, t.frames.map((f) => f.frame)])).toEqual([
      ["dry_brush", framesOf(BRUSH[0])],
      ["wooden_fence", framesOf(FENCE[1])],
    ]);
    expect(onPan.tracks.map((t) => [t.concept, t.frames.map((f) => f.frame)])).toEqual([["dry_brush", framesOf(BRUSH[0])]]);
    expect(onLoop.runs).toHaveLength(LOOP_CONCEPTS.length);
    expect(onPan.runs).toHaveLength(PAN_CONCEPTS.length);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
    expect(deleted().sort()).toEqual(["/files/file-1", "/files/file-2"]);
  });

  it("ends done with both concepts not checked when Muse Spark gave no usable answer", async () => {
    const walkId = await walkWithBothClips();
    harness.answers[asking("dry brush")] = [{ text: "no answer" }];
    harness.answers[asking("wooden fence")] = [{ text: "no answer" }];

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toEqual({ status: "done" });
    const [loop, pan] = await clipsForWalk(env.DB, walkId);
    const onLoop = await detectionsForClip(env.DB, loop!.id);
    const onPan = await detectionsForClip(env.DB, pan!.id);
    expect(onLoop.runs.filter((r) => r.outcome === "not_checked").map((r) => r.concept).sort()).toEqual(["dry_brush", "wooden_fence"]);
    expect(onPan.runs.filter((r) => r.outcome === "not_checked").map((r) => r.concept)).toEqual(["dry_brush"]);
    expect(onLoop.tracks.filter((t) => t.concept === "dry_brush" || t.concept === "wooden_fence")).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state).toEqual({ name: "done" });
  });

  it("fails the walk on real footage while on free credits and asks Muse Spark nothing", async () => {
    const walkId = await walkWithBothClips({ synthetic: false });
    stageRecorded();

    await using instance = await run(walkId);

    expect(await instance.getOutput()).toMatchObject({ status: "failed", failure: { code: "real_footage_not_allowed" } });
    expect(harness.requests.filter((r) => r.path === "/responses")).toHaveLength(0);
  });
});

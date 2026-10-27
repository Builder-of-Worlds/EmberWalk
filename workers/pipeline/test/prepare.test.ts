import { clipsForWalk } from "@emberwalk/db";
import { DEFAULT_LIMITS } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clipStart, prepareWalk, spansFor } from "../src/prepare.ts";
import { clipKey, originalKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedOriginal, seedTag, seedWalk } from "./fixtures.ts";
import { harness, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);

const processingWalk = async (): Promise<string> => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing" });
  await seedOriginal(walkId);
  return walkId;
};

beforeEach(resetAll);

describe("spansFor", () => {
  const tag = (kind: "loop" | "pan", startSeconds: number, endSeconds: number) =>
    ({ id: "x", walkId: "w", kind, startSeconds, endSeconds, label: "l", samples: [], propertyLine: null }) as never;

  it("spans the earliest start to the latest end of each kind", () => {
    expect(spansFor([tag("loop", 10, 40), tag("loop", 20, 60), tag("pan", 70, 100)], 120)).toEqual([
      { kind: "loop", start: 10, end: 60 },
      { kind: "pan", start: 70, end: 100 },
    ]);
  });

  it("cuts a tag at the end of the video and drops one that starts after it", () => {
    expect(spansFor([tag("loop", 10, 500), tag("pan", 130, 140)], 120)).toEqual([{ kind: "loop", start: 10, end: 120 }]);
  });

  it("takes the whole video as one loop when nothing usable is tagged", () => {
    expect(spansFor([], 90)).toEqual([{ kind: "loop", start: 0, end: 90 }]);
    expect(spansFor([tag("pan", 200, 210)], 90)).toEqual([{ kind: "loop", start: 0, end: 90 }]);
  });
});

describe("clipStart", () => {
  const tag = (kind: "loop" | "pan", startSeconds: number, endSeconds: number) =>
    ({ id: "x", walkId: "w", kind, startSeconds, endSeconds, label: "l", samples: [], propertyLine: null }) as never;

  it("starts each clip at the earliest tag of its kind", () => {
    const tags = [tag("loop", 20, 60), tag("loop", 10, 40), tag("pan", 70, 100)];
    expect(clipStart(tags, "loop")).toBe(10);
    expect(clipStart(tags, "pan")).toBe(70);
  });

  it("starts the fallback loop at 0 when the walk has no loop tag", () => {
    expect(clipStart([], "loop")).toBe(0);
    expect(clipStart([tag("pan", 30, 50)], "loop")).toBe(0);
  });

  it("gives 0 for a kind with no clip, never a guessed start", () => {
    expect(clipStart([tag("loop", 5, 9)], "pan")).toBe(0);
  });
});

describe("prepareWalk", () => {
  it("cuts one clip per tagged kind and saves them", async () => {
    const walkId = await processingWalk();
    await seedTag(walkId, 1, "loop", 10, 40);
    await seedTag(walkId, 2, "pan", 70, 100);

    const result = await prepareWalk(deps(), walkId);

    expect(result.ok && result.value.map((c) => c.kind)).toEqual(["loop", "pan"]);
    expect(harness.clipped.map((c) => [c.start, c.end, c.fps])).toEqual([
      [10, 40, DEFAULT_LIMITS.defaultFps],
      [70, 100, DEFAULT_LIMITS.defaultFps],
    ]);
    expect((await clipsForWalk(env.DB, walkId)).map((c) => c.kind)).toEqual(["loop", "pan"]);
  });

  it("takes the whole video as a loop when no tags were saved", async () => {
    const walkId = await processingWalk();
    harness.probe = { bytes: 1, durationSeconds: 75, isMp4: true };

    const result = await prepareWalk(deps(), walkId);

    expect(result.ok && result.value).toMatchObject([{ kind: "loop", frameCount: 60 }]);
    expect(harness.clipped.map((c) => [c.start, c.end])).toEqual([[0, 75]]);
  });

  it("points the container at the original and at where each clip goes", async () => {
    const walkId = await processingWalk();

    await prepareWalk(deps(), walkId);

    expect(new URL(harness.probed[0] as string).pathname).toBe(`/emberwalk-media/${originalKey(walkId)}`);
    expect(new URL((harness.clipped[0] as { input: string }).input).pathname).toBe(`/emberwalk-media/${originalKey(walkId)}`);
    expect(new URL((harness.clipped[0] as { output: string }).output).pathname).toBe(`/emberwalk-media/${clipKey(walkId, "loop")}`);
    expect(await env.MEDIA.head(clipKey(walkId, "loop"))).not.toBeNull();
  });

  it("keeps the clip ids when the step runs again", async () => {
    const walkId = await processingWalk();
    const first = await prepareWalk(deps(), walkId);
    const second = await prepareWalk(deps(), walkId);

    expect(first.ok && second.ok && second.value.map((c) => c.id)).toEqual(first.ok ? first.value.map((c) => c.id) : []);
    expect(await clipsForWalk(env.DB, walkId)).toHaveLength(1);
  });

  it("refuses a video the container cannot read as MP4", async () => {
    const walkId = await processingWalk();
    harness.probe = { bytes: 1, durationSeconds: 30, isMp4: false };

    const result = await prepareWalk(deps(), walkId);

    expect(result).toMatchObject({ ok: false, failure: { code: "not_mp4" } });
    expect(harness.clipped).toHaveLength(0);
  });

  it("refuses a walk longer than the limit", async () => {
    const walkId = await processingWalk();
    harness.probe = { bytes: 1, durationSeconds: DEFAULT_LIMITS.maxWalkSeconds + 1, isMp4: true };

    expect(await prepareWalk(deps(), walkId)).toMatchObject({ ok: false, failure: { code: "too_long" } });
    harness.probe = { bytes: 1, durationSeconds: DEFAULT_LIMITS.maxWalkSeconds, isMp4: true };
    expect((await prepareWalk(deps(), walkId)).ok).toBe(true);
  });

  it("passes a container refusal through, from the probe and from the cut", async () => {
    const walkId = await processingWalk();
    harness.probe = { refuse: { code: "media_corrupt", message: "The video is damaged." } };
    expect(await prepareWalk(deps(), walkId)).toEqual({ ok: false, failure: { code: "media_corrupt", message: "The video is damaged." } });

    harness.probe = { bytes: 1, durationSeconds: 30, isMp4: true };
    harness.clip = { refuse: { code: "media_no_video", message: "There is no picture." } };
    expect(await prepareWalk(deps(), walkId)).toEqual({ ok: false, failure: { code: "media_no_video", message: "There is no picture." } });
    expect(await clipsForWalk(env.DB, walkId)).toHaveLength(0);
  });

  it("refuses a cut that has no frames", async () => {
    const walkId = await processingWalk();
    harness.clip = { frames: 0, fps: 2, width: 320, height: 334 };

    expect(await prepareWalk(deps(), walkId)).toMatchObject({ ok: false, failure: { code: "no_frames" } });
    expect(await clipsForWalk(env.DB, walkId)).toHaveLength(0);
  });

  it("refuses a walk that is not being processed, or does not exist", async () => {
    const queued = freshWalkId();
    await seedWalk(queued);

    expect(await prepareWalk(deps(), queued)).toMatchObject({ ok: false, failure: { code: "walk_not_processing" } });
    expect(await prepareWalk(deps(), freshWalkId())).toMatchObject({ ok: false, failure: { code: "walk_not_processing" } });
    expect(harness.probed).toHaveLength(0);
  });

  it("lets a container error through so the step can retry", async () => {
    const walkId = await processingWalk();
    harness.probe = { throws: "the media container answered 503" };

    await expect(prepareWalk(deps(), walkId)).rejects.toThrow("503");
  });
});

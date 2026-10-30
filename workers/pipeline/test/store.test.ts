import { completeWalk, detectionsForClip, getWalk } from "@emberwalk/db";
import { PAN_CONCEPTS } from "@emberwalk/shared";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { segmentClip } from "../src/segment.ts";
import { storeWalk } from "../src/store.ts";
import { detectionsKey } from "../src/storage.ts";
import { freshWalkId, resetAll, seedClip, seedWalk } from "./fixtures.ts";
import { harness, testDeps } from "./harness.ts";

const deps = () => testDeps(env, harness);

const found = [
  { frame: 0, id: 0, box: [32, 33, 159, 166] as [number, number, number, number], confidence: 0.9 },
  { frame: 1, id: 0, box: [48, 50, 175, 183] as [number, number, number, number], confidence: 0.8 },
];

const segmentedWalk = async (kinds: ("loop" | "pan")[] = ["loop"]) => {
  const walkId = freshWalkId();
  await seedWalk(walkId, { state: "processing" });
  harness.answers["wood pile"] = [{ found }];
  const clips = [];
  for (const [n, kind] of kinds.entries()) {
    const clip = await seedClip(walkId, n + 1, kind);
    await segmentClip(deps(), walkId, clip, `file-${n + 1}`);
    clips.push(clip);
  }
  return { walkId, clips };
};

beforeEach(resetAll);

describe("storeWalk", () => {
  it("writes what SAM found to D1 and leaves the walk processing for the steps after it", async () => {
    const { walkId, clips } = await segmentedWalk();
    const clip = clips[0]!;

    await storeWalk(deps(), walkId, [clip.id]);

    const stored = await detectionsForClip(env.DB, clip.id);
    expect(stored.runs.find((r) => r.concept === "wood_pile")).toMatchObject({ outcome: "found", reason: null });
    expect(stored.runs.filter((r) => r.outcome === "none").length).toBe(stored.runs.length - 1);
    expect(stored.tracks).toHaveLength(1);
    expect(stored.tracks[0]).toMatchObject({ clipId: clip.id, concept: "wood_pile", samObjectId: 0 });
    expect(stored.tracks[0]?.frames.map((f) => f.frame)).toEqual([0, 1]);
    expect((await getWalk(env.DB, walkId))?.state).toMatchObject({ name: "processing" });
  });

  it("stores the loop clip and the pan clip", async () => {
    const { walkId, clips } = await segmentedWalk(["loop", "pan"]);

    await storeWalk(deps(), walkId, clips.map((c) => c.id));

    for (const clip of clips) expect((await detectionsForClip(env.DB, clip.id)).tracks).toHaveLength(1);
    expect((await detectionsForClip(env.DB, clips[1]!.id)).runs).toHaveLength(PAN_CONCEPTS.length);
  });

  it("keeps the walk processing and throws when a clip's detections are missing", async () => {
    const { walkId, clips } = await segmentedWalk();
    await env.MEDIA.delete(detectionsKey(walkId, clips[0]!.id));

    await expect(storeWalk(deps(), walkId, [clips[0]!.id])).rejects.toThrow("missing");

    expect((await getWalk(env.DB, walkId))?.state.name).toBe("processing");
  });

  it("throws on detections that do not have the stored shape and writes nothing", async () => {
    const { walkId, clips } = await segmentedWalk();
    await env.MEDIA.put(detectionsKey(walkId, clips[0]!.id), JSON.stringify({ runs: [{ concept: "unicorn" }], tracks: [] }));

    await expect(storeWalk(deps(), walkId, [clips[0]!.id])).rejects.toThrow();

    expect((await detectionsForClip(env.DB, clips[0]!.id)).runs).toEqual([]);
    expect((await getWalk(env.DB, walkId))?.state.name).toBe("processing");
  });

  it("finishes on a second try after one clip's detections were missing", async () => {
    const { walkId, clips } = await segmentedWalk(["loop", "pan"]);
    const [loop, pan] = clips as [(typeof clips)[number], (typeof clips)[number]];
    const panDetections = await (await env.MEDIA.get(detectionsKey(walkId, pan.id)))!.text();
    await env.MEDIA.delete(detectionsKey(walkId, pan.id));

    await expect(storeWalk(deps(), walkId, [loop.id, pan.id])).rejects.toThrow("missing");
    await env.MEDIA.put(detectionsKey(walkId, pan.id), panDetections);
    await storeWalk(deps(), walkId, [loop.id, pan.id]);

    expect((await detectionsForClip(env.DB, loop.id)).tracks).toHaveLength(1);
    expect((await detectionsForClip(env.DB, pan.id)).tracks).toHaveLength(1);
    expect((await getWalk(env.DB, walkId))?.state.name).toBe("processing");
  });

  it("does nothing when the walk is already done", async () => {
    const { walkId, clips } = await segmentedWalk();
    await storeWalk(deps(), walkId, [clips[0]!.id]);
    await completeWalk(env.DB, walkId);
    await env.MEDIA.delete(detectionsKey(walkId, clips[0]!.id));

    await expect(storeWalk(deps(), walkId, [clips[0]!.id])).resolves.toBeUndefined();
    expect((await detectionsForClip(env.DB, clips[0]!.id)).tracks).toHaveLength(1);
  });

  it("refuses a walk that does not exist or is not being processed", async () => {
    await expect(storeWalk(deps(), freshWalkId(), [])).rejects.toThrow("missing");

    const queued = freshWalkId();
    await seedWalk(queued);
    await expect(storeWalk(deps(), queued, [])).rejects.toThrow("not processing");
  });
});

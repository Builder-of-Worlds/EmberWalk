import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { saveClip } from "../src/clips.ts";
import { detectionsForClip, storeDetections } from "../src/detections.ts";
import { CLIP, clip, PAN_CLIP, resetDb, seedWalk, TRACK, TRACK_2, track, WALK } from "./fixtures.ts";

const found = { concept: "wood_pile", outcome: "found", reason: null, framesBilled: 50 } as const;
const none = { concept: "dry_brush", outcome: "none", reason: null, framesBilled: 50 } as const;
const missed = { concept: "wooden_fence", outcome: "not_checked", reason: "SAM answered 500", framesBilled: 0 } as const;

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "processing", "segment");
  await saveClip(env.DB, clip());
  await saveClip(env.DB, clip({ id: PAN_CLIP, kind: "pan", file: `clips/${WALK}/pan.mp4` }));
});

describe("storing detections", () => {
  it("stores each concept's outcome and its tracks and reads them back", async () => {
    await storeDetections(env.DB, { clipId: CLIP, runs: [found, none, missed], tracks: [track()] });
    const read = await detectionsForClip(env.DB, CLIP);
    expect(read.tracks).toEqual([track()]);
    expect(read.runs).toEqual([found, missed, none].sort((a, b) => a.concept.localeCompare(b.concept)));
  });

  it("keeps a concept that was not checked, with its reason, apart from one that found nothing", async () => {
    await storeDetections(env.DB, { clipId: CLIP, runs: [none, missed], tracks: [] });
    const { runs } = await detectionsForClip(env.DB, CLIP);
    expect(runs.find((r) => r.concept === "wooden_fence")).toMatchObject({ outcome: "not_checked", reason: "SAM answered 500" });
    expect(runs.find((r) => r.concept === "dry_brush")).toMatchObject({ outcome: "none", reason: null });
  });

  it("replaces what was stored for the clip when it is stored again", async () => {
    await storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track()] });
    await storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track({ id: TRACK_2, samObjectId: 1 })] });
    const { tracks } = await detectionsForClip(env.DB, CLIP);
    expect(tracks.map((t) => t.id)).toEqual([TRACK_2]);
  });

  it("keeps each clip's detections apart", async () => {
    await storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track()] });
    expect(await detectionsForClip(env.DB, PAN_CLIP)).toEqual({ runs: [], tracks: [] });
  });

  it("returns tracks ordered by concept then object id", async () => {
    const shrub = { concept: "shrub", outcome: "found", reason: null, framesBilled: 50 } as const;
    await storeDetections(env.DB, {
      clipId: CLIP,
      runs: [found, shrub],
      tracks: [track({ id: TRACK_2, concept: "wood_pile", samObjectId: 1 }), track({ concept: "shrub", samObjectId: 0 }), track({ id: "9a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a03", samObjectId: 0 })],
    });
    const { tracks } = await detectionsForClip(env.DB, CLIP);
    expect(tracks.map((t) => [t.concept, t.samObjectId])).toEqual([["shrub", 0], ["wood_pile", 0], ["wood_pile", 1]]);
  });

  it("refuses a track that belongs to another clip and stores nothing", async () => {
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track({ clipId: PAN_CLIP })] })).rejects.toThrow(/another clip/);
    expect(await detectionsForClip(env.DB, CLIP)).toEqual({ runs: [], tracks: [] });
  });

  it("refuses a track whose concept was not found by its run", async () => {
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [none], tracks: [track({ concept: "dry_brush" })] })).rejects.toThrow(/no run that found/);
  });

  it("refuses a found run with no track and a none run with a track", async () => {
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [] })).rejects.toThrow(/no track/);
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [{ ...none, concept: "wood_pile" }], tracks: [track()] })).rejects.toThrow();
  });

  it("refuses a not checked run with no reason and a reason on any other run", async () => {
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [{ ...missed, reason: null }], tracks: [] })).rejects.toThrow();
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [{ ...none, reason: "why" }], tracks: [] })).rejects.toThrow();
  });

  it("refuses the same concept twice and a concept outside the list", async () => {
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [none, none], tracks: [] })).rejects.toThrow();
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [{ ...none, concept: "lava" as never }], tracks: [] })).rejects.toThrow();
  });

  it("refuses detections for a clip that does not exist", async () => {
    const ghost = "8a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff";
    await expect(storeDetections(env.DB, { clipId: ghost, runs: [none], tracks: [] })).rejects.toThrow();
  });

  it("refuses two tracks with the same object id for one concept", async () => {
    await expect(
      storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track(), track({ id: TRACK_2 })] }),
    ).rejects.toThrow();
    expect(await detectionsForClip(env.DB, CLIP)).toEqual({ runs: [], tracks: [] });
  });

  it("keeps the earlier detections when a replacement is refused", async () => {
    await storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track()] });
    await expect(storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [] })).rejects.toThrow();
    expect((await detectionsForClip(env.DB, CLIP)).tracks).toEqual([track()]);
  });
});

describe("track ids", () => {
  it("are unique across clips", async () => {
    await storeDetections(env.DB, { clipId: CLIP, runs: [found], tracks: [track({ id: TRACK })] });
    await expect(
      storeDetections(env.DB, { clipId: PAN_CLIP, runs: [found], tracks: [track({ id: TRACK, clipId: PAN_CLIP })] }),
    ).rejects.toThrow();
  });
});

import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import { clipsForWalk, saveClip } from "../src/clips.ts";
import { addTag, tagsForWalk } from "../src/tags.ts";
import { CLIP, clip, OTHER_WALK, PAN_CLIP, resetDb, seedWalk, TAG, tag, WALK } from "./fixtures.ts";

beforeEach(async () => {
  await resetDb();
  await seedWalk(WALK, "processing", "prepare");
  await seedWalk(OTHER_WALK, "processing", "prepare");
});

describe("tags", () => {
  it("stores a tag and reads it back in time order", async () => {
    await addTag(env.DB, tag({ id: "7a0d3f1e-5a64-4c0e-9d57-1d0a3c9b7a09", startSeconds: 70, endSeconds: 90, kind: "pan", label: "back side" }));
    await addTag(env.DB, tag());
    const tags = await tagsForWalk(env.DB, WALK);
    expect(tags.map((t) => t.label)).toEqual(["front left corner", "back side"]);
    expect(tags[0]).toEqual(tag());
  });

  it("keeps each walk's tags apart", async () => {
    await addTag(env.DB, tag());
    expect(await tagsForWalk(env.DB, OTHER_WALK)).toEqual([]);
  });

  it("keeps a property line mark on a pan", async () => {
    const pan = tag({ kind: "pan", propertyLine: { t: 75, at: { x: 0.5, y: 0.5 } } });
    await addTag(env.DB, pan);
    expect((await tagsForWalk(env.DB, WALK))[0]).toEqual(pan);
  });

  it("refuses a tag that ends before it starts", async () => {
    await expect(addTag(env.DB, tag({ startSeconds: 9, endSeconds: 3 }))).rejects.toThrow();
  });

  it("refuses a property line on a loop", async () => {
    await expect(addTag(env.DB, tag({ propertyLine: { t: 5, at: { x: 0.1, y: 0.1 } } }))).rejects.toThrow();
  });

  it("refuses a tag for a walk that does not exist", async () => {
    await expect(addTag(env.DB, tag({ walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff" }))).rejects.toThrow();
  });

  it("refuses the same tag id twice", async () => {
    await addTag(env.DB, tag());
    await expect(addTag(env.DB, tag())).rejects.toThrow();
    expect((await tagsForWalk(env.DB, WALK)).map((t) => t.id)).toEqual([TAG]);
  });
});

describe("clips", () => {
  it("stores a clip and reads it back", async () => {
    expect(await saveClip(env.DB, clip())).toEqual(clip());
    expect(await clipsForWalk(env.DB, WALK)).toEqual([clip()]);
  });

  it("keeps one clip per kind and keeps the first id when the clip is saved again", async () => {
    await saveClip(env.DB, clip());
    const again = await saveClip(env.DB, clip({ id: PAN_CLIP, frameCount: 55 }));
    expect(again).toEqual(clip({ id: CLIP, frameCount: 55 }));
    expect(await clipsForWalk(env.DB, WALK)).toHaveLength(1);
  });

  it("holds a loop clip and a pan clip for one walk", async () => {
    await saveClip(env.DB, clip());
    await saveClip(env.DB, clip({ id: PAN_CLIP, kind: "pan", file: `clips/${WALK}/pan.mp4` }));
    expect((await clipsForWalk(env.DB, WALK)).map((c) => c.kind).sort()).toEqual(["loop", "pan"]);
  });

  it("refuses a clip with no frames or a file key that climbs out of its folder", async () => {
    await expect(saveClip(env.DB, clip({ frameCount: 0 }))).rejects.toThrow();
    await expect(saveClip(env.DB, clip({ file: "clips/../x.mp4" }))).rejects.toThrow();
    expect(await clipsForWalk(env.DB, WALK)).toEqual([]);
  });

  it("refuses a clip for a walk that does not exist", async () => {
    await expect(saveClip(env.DB, clip({ walkId: "6f0d3f1e-5a64-4c0e-9d57-1d0a3c9b7aff" }))).rejects.toThrow();
  });

  it("is removed with its walk", async () => {
    await saveClip(env.DB, clip());
    await env.DB.prepare("DELETE FROM walks WHERE id = ?").bind(WALK).run();
    expect(await clipsForWalk(env.DB, WALK)).toEqual([]);
  });
});

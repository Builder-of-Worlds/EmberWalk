// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import clip from "../../../../fixtures/synthetic/test-yard-2/import/render-30fps.json";
import walk from "../../../../fixtures/synthetic/test-yard-2/import/render.json";

const IMPORT = new URL("../../../../fixtures/synthetic/test-yard-2/import/", import.meta.url);

describe("the 30 a second clip of the hero walk", () => {
  it("is the file its record names, by size and sha256", () => {
    const bytes = readFileSync(fileURLToPath(new URL(clip.file, IMPORT)));
    expect(bytes.byteLength).toBe(clip.size_bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(clip.sha256);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
    expect(clip.size_bytes).toBeLessThanOrEqual(5_242_880);
  });

  it("shows the same twenty seconds of the same walk as the 15 a second sample, twice as often", () => {
    expect([clip.width, clip.height, clip.duration_s]).toEqual([walk.width, walk.height, walk.duration_s]);
    expect(clip.fps).toBe(2 * walk.fps);
    expect(clip.frame_count).toBe(2 * walk.frame_count);
    expect(clip.scene).toBe(walk.scene);
    expect(clip.made_from.first_frame).toBe(walk.made_from.first_frame);
    expect(clip.made_from.last_frame).toBe(walk.made_from.last_frame);
    expect(clip.made_from.sha256).toBe(walk.made_from.sha256);
  });

  it("leaves the sample walk and its record alone", () => {
    const bytes = readFileSync(fileURLToPath(new URL("walk.mp4", IMPORT)));
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(walk.sha256);
    expect(walk.fps).toBe(15);
  });
});

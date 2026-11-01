import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderFiles } from "../../vitest.l2.ts";
import { type Cut, truthFrameAt } from "../l2/files.ts";

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../../fixtures/synthetic");
const json = <T>(file: string): T => JSON.parse(readFileSync(path.join(fixtures, file), "utf8")) as T;
const IMPORT = "test-yard-2/import";

type Render = Cut & { scene: string; file: string; size_bytes: number; sha256: string; width: number; height: number; duration_s: number; frame_count: number };
type CutRender = Render & { made_from: { file: string; sha256: string; size_bytes: number; first_frame: number; last_frame: number } };
type Sample = { frame: number; t: number; pos_in: number[]; heading_deg: number; tilt_deg: number; roll_deg: number };
type Motion = { scene: string; fps: number; frame_count: number; duration_s: number; samples: Sample[]; camera: Record<string, unknown> };
type Truth = { scene: string; hazards: { concept: string; frame_boxes: { frame: number }[] }[] };

const cut = json<CutRender>(`${IMPORT}/render.json`);
const hero = json<Render>("hero-before/render.json");

describe("the sample walk video", () => {
  const bytes = readFileSync(path.join(fixtures, IMPORT, "walk.mp4"));

  it("is the file render.json names, by size and sha256", () => {
    expect(bytes.byteLength).toBe(cut.size_bytes);
    expect(createHash("sha256").update(bytes).digest("hex")).toBe(cut.sha256);
    expect(bytes.subarray(4, 8).toString("latin1")).toBe("ftyp");
  });

  it("is a cut of the hero house walk, whole frames 186 to 485 at the walk's own size and speed", () => {
    expect(cut.scene).toBe("hero-before");
    expect(cut.made_from).toMatchObject({ sha256: hero.sha256, size_bytes: hero.size_bytes, first_frame: 186, last_frame: 485 });
    expect([cut.width, cut.height, cut.fps]).toEqual([hero.width, hero.height, hero.fps]);
    expect(cut.frame_count).toBe(cut.made_from.last_frame - cut.made_from.first_frame + 1);
    expect(cut.duration_s).toBeCloseTo(cut.frame_count / cut.fps, 6);
  });

  it("has a motion file that is the same frames of the hero walk's motion, counted from the first", () => {
    const full = json<Motion>("hero-before/motion.json");
    const motion = json<Motion>(`${IMPORT}/motion.json`);
    expect(motion).toMatchObject({ scene: "hero-before", fps: cut.fps, frame_count: cut.frame_count, duration_s: cut.duration_s });
    expect(motion.camera).toEqual(full.camera);
    expect(motion.samples).toHaveLength(cut.frame_count);
    motion.samples.forEach((sample, i) => {
      const { frame, t, ...pose } = full.samples[cut.made_from.first_frame - 1 + i]!;
      expect(frame).toBe(cut.made_from.first_frame + i);
      expect(sample).toMatchObject({ frame: i + 1, ...pose });
      expect(sample.t).toBeCloseTo(i / cut.fps, 6);
      expect(t).toBeCloseTo((frame - 1) / cut.fps, 6);
    });
  });
});

describe("the truth the sample walk is read against", () => {
  it("is the hero house truth, and the cut shows a wood pile in it", async () => {
    const answer = await renderFiles(path.join(fixtures, IMPORT))(new Request("http://render/truth.json"));
    const truth = (await answer.json()) as Truth;
    expect(truth.scene).toBe("hero-before");
    const seen = truth.hazards
      .filter((h) => h.concept === "wood pile")
      .flatMap((h) => h.frame_boxes)
      .filter((b) => b.frame >= cut.made_from.first_frame && b.frame <= cut.made_from.last_frame);
    expect(seen.length).toBeGreaterThan(0);
  });

  it("numbers a 2 a second sample frame of the cut by the hero walk frame shown at that moment", () => {
    expect(truthFrameAt(cut, 0, 2)).toBe(186);
    expect(truthFrameAt(cut, 2, 2)).toBe(201);
    expect(truthFrameAt(cut, 39, 2)).toBe(186 + 293);
  });
});

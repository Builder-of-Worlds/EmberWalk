import { describe, expect, it } from "vitest";
import { type Hazard, iou, matchHazard, motion, type Rect, toCamera, toImage, truth, truthRect, windowFrames } from "./live/env.ts";

const m = motion();
const hazards = truth().hazards;
const byId = (id: string): Hazard => hazards.find((h) => h.id === id)!;
const FPS = 2;

function visibleByRule(h: Hazard): number {
  const point: [number, number, number] = [(h.box_in.min[0] + h.box_in.max[0]) / 2, h.box_in.min[1], 0];
  return m.samples.filter((pose) => {
    const c = toCamera(point, pose);
    if (c[2] >= 0) return false;
    const [u, v] = toImage(c, m.camera);
    return u >= 0 && u <= m.camera.width_px && v >= 0 && v <= m.camera.height_px;
  }).length;
}

describe("live test geometry against the synthetic truth", () => {
  it("projects each hazard visible on exactly the frames the Blender truth file counts", () => {
    for (const h of hazards) {
      expect(visibleByRule(h), h.id).toBe((h as Hazard & { visible_frames: number }).visible_frames);
    }
  });

  it("counts a window frame as a hit only when a box lands on the projected hazard", () => {
    const pile = byId("wood-pile-1");
    const found = windowFrames(pile.visible_s, FPS).map((frame) => ({ frame, objects: [{ box: truthRect(pile, m, frame / FPS)! }] }));
    const r = matchHazard(pile, found, m, FPS);
    expect(r.hits).toEqual(r.window);
    expect(r.elsewhere).toEqual([]);
  });

  it("refuses a box on the house wall as the fence, as SAM answered live", () => {
    const fence = byId("fence-joint-1");
    const wall: Rect = { left: 200, top: 0, right: 1920, bottom: 640 };
    const found = windowFrames(fence.visible_s, FPS).map((frame) => ({ frame, objects: [{ box: wall }] }));
    const r = matchHazard(fence, found, m, FPS);
    expect(r.hits).toEqual([]);
    expect(r.elsewhere).toEqual(r.window);
  });

  it("finds nothing on frames with no objects", () => {
    const brush = byId("dry-brush-1");
    expect(matchHazard(brush, [{ frame: 20, objects: [] }], m, FPS)).toMatchObject({ hits: [], elsewhere: [] });
  });

  it("clips a box that runs behind the camera at the near plane", () => {
    const rect = truthRect(byId("fence-joint-1"), m, 17.5)!;
    expect(rect.left).toBe(0);
    expect(rect.right).toBeGreaterThan(200);
    expect(rect.right).toBeLessThan(320);
  });

  it("gives no rectangle for a hazard wholly behind the camera", () => {
    const behind: Hazard = { ...byId("wood-pile-1"), box_in: { min: [96, 400, 0], max: [168, 418, 48] } };
    expect(truthRect(behind, m, 0)).toBeNull();
  });

  it("scores overlap as intersection over union", () => {
    const a: Rect = { left: 0, top: 0, right: 10, bottom: 10 };
    expect(iou(a, a)).toBe(1);
    expect(iou(a, { left: 5, top: 0, right: 15, bottom: 10 })).toBeCloseTo(50 / 150, 12);
    expect(iou(a, { left: 20, top: 20, right: 30, bottom: 30 })).toBe(0);
    expect(iou({ left: 5, top: 5, right: 5, bottom: 5 }, { left: 5, top: 5, right: 5, bottom: 5 })).toBe(0);
  });
});

import type { MotionSample } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { partsOf } from "../../src/parts.ts";

const sample = (t: number, headingDegrees: number): MotionSample => ({ t, tiltDegrees: -5, headingDegrees: ((headingDegrees % 360) + 360) % 360 });

const syntheticWalk = (seconds: number, corners: readonly number[], turn: -1 | 1): MotionSample[] => {
  const samples: MotionSample[] = [];
  for (let t = 0; t <= seconds; t += 1) {
    const done = corners.filter((at) => at <= t).length;
    const turning = corners.some((at) => at - 1 === t) ? 45 : 0;
    samples.push(sample(t, turn * (90 * done + turning)));
  }
  return samples;
};

const LEFT = -1;
const RIGHT = 1;

describe("partsOf", () => {
  it("cuts a synthetic walk of four left turns into front, right, back and left at its corners", () => {
    expect(partsOf(45_000, syntheticWalk(45, [10, 20, 30, 40], LEFT))).toEqual([
      { side: "front", startSeconds: 0, endSeconds: 10 },
      { side: "right", startSeconds: 10, endSeconds: 20 },
      { side: "back", startSeconds: 20, endSeconds: 30 },
      { side: "left", startSeconds: 30, endSeconds: 45 },
    ]);
  });

  it("gives the mirrored order for a synthetic walk of four right turns", () => {
    expect(partsOf(45_000, syntheticWalk(45, [10, 20, 30, 40], RIGHT)).map((part) => part.side)).toEqual(["front", "left", "back", "right"]);
  });

  it("gives three sides for a synthetic walk that stops after two corners, ending at the take's end", () => {
    expect(partsOf(30_500, syntheticWalk(30, [12, 21], LEFT))).toEqual([
      { side: "front", startSeconds: 0, endSeconds: 12 },
      { side: "right", startSeconds: 12, endSeconds: 21 },
      { side: "back", startSeconds: 21, endSeconds: 30.5 },
    ]);
  });

  it("keeps the walking order of the first corner when the person later turns the other way", () => {
    const headingAt = (t: number) => (t < 10 ? 0 : t < 20 ? -90 : t < 24 ? 90 * (t - 20) : 270);
    const samples = Array.from({ length: 31 }, (_, t) => sample(t, headingAt(t)));
    expect(partsOf(30_000, samples)).toEqual([
      { side: "front", startSeconds: 0, endSeconds: 10 },
      { side: "right", startSeconds: 10, endSeconds: 22 },
      { side: "back", startSeconds: 22, endSeconds: 23 },
      { side: "left", startSeconds: 23, endSeconds: 30 },
    ]);
  });

  it("keeps the sides when one sample in a good walk is broken", () => {
    const samples = syntheticWalk(45, [10, 20, 30, 40], LEFT).map((s) => (s.t === 15 ? { ...s, headingDegrees: Number.NaN } : s));
    expect(partsOf(45_000, samples).map((part) => part.side)).toEqual(["front", "right", "back", "left"]);
  });

  it.each([
    ["no samples", []],
    ["one sample", [sample(1, 0)]],
    ["headings that are not numbers", [sample(1, 0), sample(2, 0), sample(3, 0)].map((s) => ({ ...s, headingDegrees: Number.NaN }))],
    ["times past the take's end", syntheticWalk(60, [50, 55], LEFT).filter((s) => s.t > 45)],
    ["times that are not numbers", syntheticWalk(45, [10], LEFT).map((s) => ({ ...s, t: Number.NaN }))],
  ] as const)("gives one part with no side for %s, covering the whole take", (_name, samples) => {
    expect(partsOf(45_000, samples)).toEqual([{ side: null, startSeconds: 0, endSeconds: 45 }]);
  });

  it.each([0, -1000, Number.NaN, Number.POSITIVE_INFINITY])("gives no part for a duration of %s, never throwing", (durationMs) => {
    expect(partsOf(durationMs, syntheticWalk(45, [10, 20], LEFT))).toEqual([]);
  });

  it("gives one side for a synthetic walk that turns back and forth on the spot and never reaches a corner", () => {
    const samples = Array.from({ length: 40 }, (_, t) => sample(t, t % 2 === 0 ? 30 : -30));
    expect(partsOf(40_000, samples)).toEqual([{ side: "front", startSeconds: 0, endSeconds: 40 }]);
  });

  it("never makes a fifth side, however many corners are turned", () => {
    const parts = partsOf(90_000, syntheticWalk(90, [10, 20, 30, 40, 50, 60, 70, 80], LEFT));
    expect(parts.map((part) => part.side)).toEqual(["front", "right", "back", "left"]);
    expect(parts.at(-1)).toEqual({ side: "left", startSeconds: 30, endSeconds: 90 });
  });

  it("joins the parts end to end with no gap or overlap", () => {
    const parts = partsOf(45_000, syntheticWalk(45, [10, 20, 30], RIGHT));
    for (const [i, part] of parts.entries()) {
      expect(part.startSeconds).toBe(i === 0 ? 0 : parts[i - 1]?.endSeconds);
      expect(part.startSeconds).toBeLessThan(part.endSeconds);
    }
    expect(parts.at(-1)?.endSeconds).toBe(45);
  });
});

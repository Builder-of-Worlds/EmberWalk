import { describe, expect, it } from "vitest";
import {
  Clip,
  Concept,
  Corner,
  CORNERS,
  cornerBetween,
  cornerLabel,
  Gap,
  isCorner,
  LightReading,
  Part,
  PARTS,
  tagCorner,
  GAP_HINTS,
  GAP_KINDS,
  HINTS_FOR,
  LOOP_CONCEPTS,
  MotionSample,
  PAN_CONCEPTS,
  Side,
  SIDES,
  Tag,
  tagSide,
  Track,
  TrackFrame,
  Visitor,
  Walk,
  WalkState,
} from "../src/index.ts";
import { AT, FP, id, refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";
import sideWalk from "../../../fixtures/synthetic/side-walk/walk.json";

const walk = {
  id: id(1),
  visitorId: FP,
  createdAt: AT,
  state: { name: "processing", step: "segment" },
  lengthSeconds: 312.5,
  language: "en",
  jurisdiction: "ca_sra",
  shareCode: null,
  device: { camera: "back wide", width: 1920, height: 1080 },
  synthetic: true,
  motionFile: "originals/w1/motion.json",
};

const tag = {
  id: id(2),
  walkId: id(1),
  kind: "pan",
  startSeconds: 10,
  endSeconds: 40,
  label: "back side",
  samples: [{ t: 10, tiltDegrees: -20, headingDegrees: 359.9 }],
  propertyLine: { t: 22, at: { x: 0.4, y: 0.6 } },
};

const frame = { frame: 0, box: [0.1, 0.2, 0.3, 0.4], mask: "clips/w1/m0.png", confidence: 0.9 };

describe("walk records", () => {
  it("lists the concepts from the design", () => {
    expect(LOOP_CONCEPTS).toHaveLength(26);
    expect(PAN_CONCEPTS).toHaveLength(18);
    for (const c of PAN_CONCEPTS) roundTrips(Concept, c);
    refuses(Concept, "car");
  });

  it("round trips every walk state and refuses a step where none belongs", () => {
    for (const state of [
      { name: "recording" },
      { name: "uploading" },
      { name: "queued" },
      { name: "processing", step: "prepare" },
      { name: "done" },
      { name: "failed", step: "report" },
    ]) {
      roundTrips(WalkState, state);
    }
    refuses(WalkState, { name: "processing" });
    refuses(WalkState, { name: "failed", step: "dance" });
    refuses(WalkState, { name: "done", step: "report" });
    refuses(WalkState, { name: "paused" });
  });

  describe("the count of a processing stage", () => {
    it("round trips a count of whole numbers, from none done to all done", () => {
      for (const progress of [{ done: 0, total: 13 }, { done: 9, total: 13 }, { done: 2, total: 2 }, null]) {
        roundTrips(WalkState, { name: "processing", step: "segment", progress });
      }
    });

    it("refuses more done than the total, a negative or fractional count, and an empty stage", () => {
      for (const progress of [{ done: 14, total: 13 }, { done: -1, total: 13 }, { done: 1.5, total: 13 }, { done: 0, total: 0 }, { done: 1 }]) {
        refuses(WalkState, { name: "processing", step: "segment", progress });
      }
      refuses(WalkState, { name: "processing", step: "segment", progress: { done: 1, total: 2, extra: 1 } });
    });

    it("still reads a processing state with no count, which carries none", () => {
      const parsed = WalkState.parse({ name: "processing", step: "segment" });
      expect(parsed).toEqual({ name: "processing", step: "segment" });
      expect(parsed.name === "processing" ? (parsed.progress ?? null) : "not processing").toBeNull();
    });

    it("refuses a count on any state but processing", () => {
      refuses(WalkState, { name: "done", progress: { done: 2, total: 2 } });
      refuses(WalkState, { name: "failed", step: "score", progress: { done: 1, total: 13 } });
    });
  });

  it("round trips a visitor and refuses a bad one", () => {
    const visitor = { id: FP, createdAt: AT, language: "es", liveWalksToday: 0 };
    roundTrips(Visitor, visitor);
    refusesMissingAndExtra(Visitor, visitor);
    refusesEach(Visitor, visitor, [{ liveWalksToday: -1 }, { liveWalksToday: 0.5 }, { language: "de" }]);
  });

  it("round trips a walk and refuses a bad one", () => {
    roundTrips(Walk, walk);
    roundTrips(Walk, { ...walk, shareCode: "abc123xyz0", motionFile: null, state: { name: "done" } });
    refusesMissingAndExtra(Walk, walk);
    refusesEach(Walk, walk, [
      { lengthSeconds: -1 },
      { shareCode: "ABC123XYZ0" },
      { shareCode: "abc" },
      { jurisdiction: "California" },
      { device: { camera: "x", width: 0, height: 1080 } },
      { device: { camera: "x", width: 8193, height: 1080 } },
      { synthetic: "yes" },
      { motionFile: "elsewhere/m.json" },
    ]);
  });

  it("round trips a tag and holds its time order", () => {
    roundTrips(Tag, tag);
    roundTrips(Tag, { ...tag, kind: "loop", propertyLine: null, samples: [] });
    refusesMissingAndExtra(Tag, tag);
    refusesEach(Tag, tag, [
      { endSeconds: 10 },
      { endSeconds: 9 },
      { kind: "loop" },
      { label: "" },
      { label: "x".repeat(61) },
    ]);
    roundTrips(Tag, { ...tag, endSeconds: 10.001 });
  });

  it("keeps motion samples in range", () => {
    roundTrips(MotionSample, { t: 0, tiltDegrees: -180, headingDegrees: 0 });
    roundTrips(MotionSample, { t: 0, tiltDegrees: 180, headingDegrees: 0 });
    for (const bad of [{ tiltDegrees: 181 }, { tiltDegrees: -181 }, { headingDegrees: 360 }, { headingDegrees: -1 }, { t: -1 }]) {
      refuses(MotionSample, { t: 0, tiltDegrees: 0, headingDegrees: 0, ...bad });
    }
  });

  it("carries the light the camera saw with a motion sample, from 0 to 255, and keeps samples from phones that sent none", () => {
    for (const light of [0, 37.5, 255]) roundTrips(MotionSample, { t: 1, tiltDegrees: 10, headingDegrees: 90, light });
    roundTrips(MotionSample, { t: 1, tiltDegrees: 10, headingDegrees: 90 });
    for (const light of [-1, 256, Number.NaN, "bright", null]) refuses(MotionSample, { t: 1, tiltDegrees: 10, headingDegrees: 90, light });
    roundTrips(Tag, { ...tag, samples: [{ t: 10, tiltDegrees: -20, headingDegrees: 12, light: 140 }] });
  });

  it("carries the light the camera saw without the compass, as readings of a time and a light from 0 to 255, strict, at most 10,000 to a tag", () => {
    for (const light of [0, 37.5, 255]) roundTrips(LightReading, { t: 1.5, light });
    refusesMissingAndExtra(LightReading, { t: 1.5, light: 90 });
    for (const bad of [{ light: -1 }, { light: 256 }, { light: Number.NaN }, { light: "bright" }, { light: null }, { t: -1 }, { t: "now" }]) {
      refuses(LightReading, { t: 1.5, light: 90, ...bad });
    }
    roundTrips(Tag, { ...tag, light: [{ t: 10, light: 140 }, { t: 10.1, light: 0 }] });
    roundTrips(Tag, { ...tag, light: [] });
    roundTrips(Tag, tag);
    refusesEach(Tag, tag, [
      { light: [{ t: 10, light: 256 }] },
      { light: [{ t: 10, light: 90, heading: 3 }] },
      { light: [{ t: 10 }] },
      { light: [{ t: 10, tiltDegrees: 0, headingDegrees: 0, light: 90 }] },
      { light: "dark" },
      { light: null },
    ]);
    const reading = { t: 10, light: 90 };
    roundTrips(Tag, { ...tag, light: Array.from({ length: 10_000 }, () => reading) });
    refuses(Tag, { ...tag, light: Array.from({ length: 10_001 }, () => reading) });
  });

  it("reads the side a tag is labelled with, and no side from any other label", () => {
    for (const side of SIDES) expect(tagSide({ label: side })).toBe(side);
    for (const label of ["Walk", "back side", "Front", "corner 0", ""]) expect(tagSide({ label })).toBeNull();
  });

  it("round trips a clip and refuses a bad one", () => {
    const clip = { id: id(3), walkId: id(1), kind: "loop", file: "clips/w1/loop.mp4", fps: 2, frameCount: 180, width: 1280, height: 720 };
    roundTrips(Clip, clip);
    refusesMissingAndExtra(Clip, clip);
    refusesEach(Clip, clip, [{ fps: 0 }, { fps: 61 }, { frameCount: 0 }, { kind: "zoom" }, { height: 1.5 }]);
  });

  it("round trips a track and refuses empty or inverted boxes", () => {
    const track = { id: id(4), clipId: id(3), concept: "wood_pile", samObjectId: 0, frames: [frame, { ...frame, frame: 1, mask: null }] };
    roundTrips(Track, track);
    refusesMissingAndExtra(Track, track);
    refusesEach(Track, track, [{ frames: [] }, { samObjectId: -1 }, { concept: "boat" }]);
    for (const box of [[0.3, 0.2, 0.3, 0.4], [0.1, 0.4, 0.3, 0.4], [0.3, 0.2, 0.1, 0.4], [0.1, 0.2, 0.3], [0, 0, 1.1, 1]]) {
      refuses(TrackFrame, { ...frame, box });
    }
    roundTrips(TrackFrame, { ...frame, box: [0, 0, 1, 1], confidence: 1 });
    refuses(TrackFrame, { ...frame, confidence: 1.01 });
  });

  it("names the four sides in walking order and each gap with a hint that suits its kind", () => {
    expect(SIDES).toEqual(["front", "right", "back", "left"]);
    for (const side of SIDES) roundTrips(Side, side);
    for (const side of ["roof", "Front", "", null]) refuses(Side, side);
    for (const kind of GAP_KINDS) {
      for (const hint of GAP_HINTS) {
        const gap = { side: hint === "pan_corner" ? "back_left" : "back", kind, hint };
        if (HINTS_FOR[kind].includes(hint)) roundTrips(Gap, gap);
        else refuses(Gap, gap);
      }
    }
    expect(GAP_HINTS.filter((hint) => GAP_KINDS.some((kind) => HINTS_FOR[kind].includes(hint)))).toEqual([...GAP_HINTS]);
    const gap = { side: "front", kind: "missing", hint: "walk_side" };
    refusesMissingAndExtra(Gap, gap);
    refusesEach(Gap, gap, [{ side: "roof" }, { kind: "smoke" }, { hint: "dance" }, { hint: "again" }]);
  });

  it("names the four corners between the sides, and the eight parts as the loop's sides then the corners", () => {
    expect(CORNERS).toEqual(["front_right", "back_right", "back_left", "front_left"]);
    expect(PARTS).toEqual([...SIDES, ...CORNERS]);
    for (const part of PARTS) roundTrips(Part, part);
    for (const part of ["roof", "front right", "Front_right", "right_front", "", null]) refuses(Part, part);
    for (const corner of CORNERS) roundTrips(Corner, corner);
    for (const side of SIDES) refuses(Corner, side);
    expect(PARTS.filter(isCorner)).toEqual([...CORNERS]);
  });

  it("finds the corner between two sides next to each other, and none between opposite sides or one side", () => {
    expect(cornerBetween("front", "right")).toBe("front_right");
    expect(cornerBetween("right", "front")).toBe("front_right");
    expect(cornerBetween("right", "back")).toBe("back_right");
    expect(cornerBetween("back", "left")).toBe("back_left");
    expect(cornerBetween("left", "front")).toBe("front_left");
    expect(cornerBetween("front", "back")).toBeNull();
    expect(cornerBetween("left", "right")).toBeNull();
    expect(cornerBetween("left", "left")).toBeNull();
  });

  it("reads the corner a pan is labelled with, and no corner from a side or any other label", () => {
    for (const corner of CORNERS) {
      expect(cornerLabel(corner)).toBe(`${corner.replace("_", " ")} corner`);
      expect(tagCorner({ label: cornerLabel(corner) })).toBe(corner);
      expect(tagSide({ label: cornerLabel(corner) })).toBeNull();
    }
    expect(cornerLabel("back_left")).toBe("back left corner");
    for (const label of ["front", "front_right", "front right", "left front corner", "Front right corner", "front right corner ", "corner"]) {
      expect(tagCorner({ label })).toBeNull();
    }
  });

  it("asks for a corner pan only at a corner, and a side walk only along a side", () => {
    expect(HINTS_FOR.missing).toEqual(["walk_side", "pan_corner"]);
    roundTrips(Gap, { side: "back_left", kind: "missing", hint: "pan_corner" });
    roundTrips(Gap, { side: "front_right", kind: "dark", hint: "more_light" });
    roundTrips(Gap, { side: "front_right", kind: "not_checked", hint: "again" });
    refuses(Gap, { side: "back_left", kind: "missing", hint: "walk_side" });
    refuses(Gap, { side: "back", kind: "missing", hint: "pan_corner" });
    refuses(Gap, { side: "back_left", kind: "dark", hint: "pan_corner" });
  });
});

describe("the two part walk in the upload metadata", () => {
  const tags = sideWalk.tags.map((t) => Tag.parse({ ...t, walkId: id(1) }));
  const sidesOf = (kind: "loop" | "pan") => tags.filter((t) => t.kind === kind).map((t) => tagSide(t));

  it('"two part walk (inner loop, then corner pans)": the synthetic sample\'s tags are the loop, one tag per side, then one pan per corner, in walk order, each with light', () => {
    expect(sideWalk.synthetic).toBe(true);
    expect(tags.map((t) => t.kind)).toEqual(["loop", "loop", "loop", "loop", "pan", "pan", "pan", "pan"]);
    expect(sidesOf("loop")).toEqual(["front", "left", "back", "right"]);
    expect(sidesOf("pan")).toEqual([null, null, null, null]);
    const loop = sidesOf("loop") as Side[];
    expect(tags.filter((t) => t.kind === "pan").map((t) => tagCorner(t))).toEqual(loop.map((side, i) => cornerBetween(side, loop[(i + 1) % 4]!)));
    expect(tags.filter((t) => t.kind === "pan").map((t) => tagCorner(t))).toEqual(["front_left", "back_left", "back_right", "front_right"]);
    for (const [i, t] of tags.entries()) {
      if (i > 0) expect(t.startSeconds).toBeGreaterThanOrEqual(tags[i - 1]!.endSeconds);
      expect(t.samples.length).toBeGreaterThan(0);
      for (const sample of t.samples) {
        expect(sample.light).toEqual(expect.any(Number));
        expect(sample.t >= t.startSeconds && sample.t <= t.endSeconds).toBe(true);
      }
    }
  });

  it("refuses a tag whose samples carry light outside 0 to 255", () => {
    const first = sideWalk.tags[0]!;
    refuses(Tag, { ...first, walkId: id(1), samples: [{ ...first.samples[0]!, light: 300 }] });
  });
});

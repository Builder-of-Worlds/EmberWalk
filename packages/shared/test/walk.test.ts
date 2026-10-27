import { describe, expect, it } from "vitest";
import {
  Clip,
  Concept,
  LOOP_CONCEPTS,
  MotionSample,
  PAN_CONCEPTS,
  Tag,
  Track,
  TrackFrame,
  Visitor,
  Walk,
  WalkState,
} from "../src/index.ts";
import { AT, FP, id, refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

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
    expect(LOOP_CONCEPTS).toHaveLength(15);
    expect(PAN_CONCEPTS).toHaveLength(8);
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
});

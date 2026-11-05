import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@emberwalk/shared";
import { observe, type ObserveInput } from "../src/index.ts";
import { LOOP_CLIP, LOOP_TAG, trackId } from "./yard.ts";

type Box = [number, number, number, number];
const FRAMES = [0, 1, 2, 3];
const BANDS = 32;
const pan: Clip = { ...LOOP_CLIP, id: "00000000-0000-4000-8000-0000000000c2", kind: "pan", file: "clips/test/pan.mp4" };
const loop: Clip = { ...LOOP_CLIP, id: "00000000-0000-4000-8000-0000000000c3", file: "clips/test/loop.mp4" };
const samples = (from: number, tiltDegrees: number, headingDegrees: number) =>
  Array.from({ length: 20 }, (_, i) => ({ t: from + i / 10, tiltDegrees, headingDegrees }));
const track = (n: number, concept: Track["concept"], box: Box): Track => ({
  id: trackId(n),
  clipId: loop.id,
  concept,
  samObjectId: n,
  frames: FRAMES.map((frame) => ({ frame, box, mask: null, confidence: 0.8 })),
});
const bands = (fill: (band: number) => number | null) => Array.from({ length: BANDS }, (_, band) => fill(band));
const inFrames = (row: (number | null)[]) => Object.fromEntries(FRAMES.map((frame) => [frame, row]));

const contactOfPile = (masks: Record<string, Record<number, (number | null)[]>>) => {
  const input = {
    clips: [loop, pan],
    tracks: [track(99, "house_wall", [0, 0.1, 1, 0.6]), track(2, "wood_pile", [0.3, 0.4, 0.5, 0.6])],
    tags: [
      { ...LOOP_TAG, startSeconds: 0, endSeconds: 2, samples: samples(0, 10, 180) },
      { ...LOOP_TAG, id: "00000000-0000-4000-8000-0000000000a2", kind: "pan" as const, startSeconds: 10, endSeconds: 12, samples: samples(10, 10, 0), propertyLine: null },
    ],
    startByClip: { [loop.id]: 0, [pan.id]: 10 },
    masks,
  } as ObserveInput;
  return observe(input).kept.find((k) => k.observation.concept === "wood_pile")?.observation.contact;
};

const SHED: Box = [0.6, 0.15, 0.97, 0.48];
const SHEDS_OWN_WALL: Box = [0.62, 0.22, 0.95, 0.48];

const contactOfShed = (masks: ObserveInput["masks"]) =>
  observe({
    clips: [loop, pan],
    tracks: [track(99, "house_wall", [0, 0.1, 0.4, 0.6]), track(98, "house_wall", SHEDS_OWN_WALL), track(3, "shed", SHED)],
    tags: [
      { ...LOOP_TAG, startSeconds: 0, endSeconds: 2, samples: samples(0, 10, 180) },
      { ...LOOP_TAG, id: "00000000-0000-4000-8000-0000000000a2", kind: "pan" as const, startSeconds: 10, endSeconds: 12, samples: samples(10, 10, 0), propertyLine: null },
    ],
    startByClip: { [loop.id]: 0, [pan.id]: 10 },
    masks,
  } as ObserveInput).kept.find((k) => k.observation.concept === "shed")?.observation;

describe("a wall read on the object itself", () => {
  it("never makes a shed touch the house, by boxes or by masks, when the only wall in its columns lies inside the shed", () => {
    const own = inFrames(bands((band) => (band >= 20 && band <= 30 ? 0.48 : null)));
    for (const seen of [contactOfShed(undefined), contactOfShed({ [trackId(98)]: own, [trackId(3)]: own })]) expect(seen?.contact ?? "dropped").not.toBe("yes");
  });
});

describe("wall contact is read from the masks", () => {
  it('a wood pile, fence or shrub whose mask touches or overlaps the wall mask in at least 2 frames is touching the wall; a pile whose box bottom meets the wall but whose mask stays well above the wall mask is not touching it', () => {
    const wall = inFrames(bands(() => 0.6));
    const pile = inFrames(bands((band) => (band >= 10 && band <= 15 ? 0.3 : null)));
    expect(contactOfPile({ [trackId(99)]: wall, [trackId(2)]: pile })).toBe("no");
  });
});

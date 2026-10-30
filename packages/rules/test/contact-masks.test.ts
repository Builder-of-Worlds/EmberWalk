import { describe, expect, it } from "vitest";
import type { Clip, Track } from "@emberwalk/shared";
import { CONTACT_MARGIN, MASK_BANDS, observe, type ObserveInput } from "../src/index.ts";
import { LOOP_CLIP, LOOP_TAG, trackId } from "./yard.ts";

type Box = [number, number, number, number];
type Bands = (number | null)[];
const FRAMES = [0, 1, 2, 3];
const WALL = trackId(99);
const WALL_B = trackId(98);
const PILE = trackId(2);
const loop: Clip = { ...LOOP_CLIP, id: "00000000-0000-4000-8000-0000000000c3", file: "clips/test/loop.mp4" };
const samples = Array.from({ length: 20 }, (_, i) => ({ t: i / 10, tiltDegrees: 10, headingDegrees: 180 }));
const track = (n: number, concept: Track["concept"], box: Box): Track => ({
  id: trackId(n),
  clipId: loop.id,
  concept,
  samObjectId: n,
  frames: FRAMES.map((frame) => ({ frame, box, mask: null, confidence: 0.8 })),
});
const bands = (from: number, to: number, row: number): Bands => Array.from({ length: MASK_BANDS }, (_, band) => (band >= from && band <= to ? row : null));
const inFrames = (row: Bands, frames = FRAMES) => Object.fromEntries(frames.map((frame) => [frame, row]));
const WALL_BOX: Box = [0, 0.3, 1, 0.8];
const BOX_TOUCHING: Box = [0.3, 0.6, 0.5, 0.8];
const BOX_AWAY: Box = [0.3, 0.5, 0.5, 0.65];

const input = (masks: ObserveInput["masks"], pileBox: Box = BOX_TOUCHING, extra: Track[] = []): ObserveInput => ({
  clips: [loop],
  tracks: [track(99, "house_wall", WALL_BOX), track(2, "wood_pile", pileBox), ...extra],
  tags: [{ ...LOOP_TAG, startSeconds: 0, endSeconds: 2, samples }],
  startByClip: { [loop.id]: 0 },
  ...(masks === undefined ? {} : { masks }),
});
const contact = (masks: ObserveInput["masks"], pileBox?: Box, extra?: Track[]) =>
  observe(input(masks, pileBox, extra)).kept.find((k) => k.observation.concept === "wood_pile")?.observation.contact;

describe("wall contact read from the masks", () => {
  it("is yes when the pile's lowest row meets the wall's in a shared band, though the boxes are apart", () => {
    expect(contact(undefined, BOX_AWAY)).toBe("no");
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)), [PILE]: inFrames(bands(10, 15, 0.5 - CONTACT_MARGIN)) }, BOX_AWAY)).toBe("yes");
  });

  it("is no when the masks share bands and none comes within the margin, though the boxes touch", () => {
    expect(contact(undefined)).toBe("yes");
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)), [PILE]: inFrames(bands(10, 15, 0.5 - CONTACT_MARGIN - 0.01)) })).toBe("no");
  });

  it("needs a touching band in at least 2 frames", () => {
    const pile = { ...inFrames(bands(10, 15, 0.3)), 2: bands(10, 15, 0.5) };
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)), [PILE]: pile }, BOX_AWAY)).toBe("no");
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)), [PILE]: { ...pile, 3: bands(10, 15, 0.5) } }, BOX_AWAY)).toBe("yes");
  });

  it("is not checked when the masks share no band in 2 frames", () => {
    expect(contact({ [WALL]: inFrames(bands(0, 9, 0.5)), [PILE]: inFrames(bands(10, 15, 0.5)) })).toBe("not_checked");
  });

  it("reads every wall track's mask in the frame", () => {
    const walls = { [WALL]: inFrames(bands(0, 15, 0.5)), [WALL_B]: inFrames(bands(16, 31, 0.5)) };
    expect(contact({ ...walls, [PILE]: inFrames(bands(20, 25, 0.5)) }, BOX_AWAY, [track(98, "house_wall", WALL_BOX)])).toBe("yes");
  });

  it("lets masks on exactly 2 frames decide", () => {
    const wall = inFrames(bands(0, 31, 0.5));
    expect(contact({ [WALL]: wall, [PILE]: inFrames(bands(10, 15, 0.5), [1, 2]) }, BOX_AWAY)).toBe("yes");
    expect(contact({ [WALL]: wall, [PILE]: inFrames(bands(10, 15, 0.3), [1, 2]) })).toBe("no");
  });

  it("is no when the masks share a single band and it stays apart", () => {
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)), [PILE]: inFrames(bands(10, 10, 0.3)) })).toBe("no");
  });

  it("takes the lowest wall row where two wall masks cover the same band", () => {
    const walls = { [WALL]: inFrames(bands(20, 25, 0.7)), [WALL_B]: inFrames(bands(0, 31, 0.5)) };
    const wallB = [track(98, "house_wall", WALL_BOX)];
    expect(contact({ ...walls, [PILE]: inFrames(bands(20, 25, 0.7)) }, BOX_AWAY, wallB)).toBe("yes");
    expect(contact({ ...walls, [PILE]: inFrames(bands(20, 25, 0.5)) }, BOX_AWAY, wallB)).toBe("no");
  });

  it("keeps the box rule when either track has masks on fewer than 2 frames", () => {
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)) }, BOX_AWAY)).toBe("no");
    expect(contact({ [PILE]: inFrames(bands(10, 15, 0.3)) })).toBe("yes");
    expect(contact({ [WALL]: inFrames(bands(0, 31, 0.5)), [PILE]: inFrames(bands(10, 15, 0.3), [1]) })).toBe("yes");
  });
});

describe("observe refuses malformed masks", () => {
  const wall = inFrames(bands(0, 31, 0.5));

  it(`throws on a frame without exactly ${MASK_BANDS} bands`, () => {
    expect(() => observe(input({ [WALL]: wall, [PILE]: inFrames(bands(0, 30, 0.5).slice(1)) }))).toThrow(/32 bands/);
  });

  it("throws on a band row outside 0 to 1", () => {
    expect(() => observe(input({ [WALL]: wall, [PILE]: inFrames(bands(10, 15, 1.2)) }))).toThrow(/0 to 1/);
    expect(() => observe(input({ [WALL]: wall, [PILE]: inFrames(bands(10, 15, -0.1)) }))).toThrow(/0 to 1/);
  });

  it("accepts band rows of exactly 0 and exactly 1", () => {
    expect(contact({ [WALL]: wall, [PILE]: inFrames([0, 1, ...Array<null>(MASK_BANDS - 2).fill(null)]) })).toBe("no");
  });

  it("throws on masks for a track not given", () => {
    expect(() => observe(input({ [WALL]: wall, [trackId(7)]: wall }))).toThrow(/track not given/);
  });
});

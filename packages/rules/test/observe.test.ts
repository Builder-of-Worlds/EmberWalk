import { describe, expect, it } from "vitest";
import type { Clip, Tag, Track } from "@emberwalk/shared";
import { bandFor, CONTACT_MARGIN, contactOf, EDGE_MARGIN, MAX_TRACKS, MIN_CONFIDENCE, observe, type ObserveInput } from "../src/index.ts";
import { HAZARDS, hazardTrack, inside, LOOP_CLIP, LOOP_TAG, trackId, wallTrack, yardTracks } from "./yard.ts";

const yard = (tracks: Track[], extra: { clips?: Clip[]; tags?: Tag[]; startByClip?: Record<string, number> } = {}) =>
  observe({
    clips: [LOOP_CLIP, ...(extra.clips ?? [])],
    tracks,
    tags: [LOOP_TAG, ...(extra.tags ?? [])],
    startByClip: { [LOOP_CLIP.id]: 0, ...extra.startByClip },
  });

const UNMEASURED = "no wall, no tilt or only the horizon on its frames, so its distance is unknown";

const TRUTH_CONTACT = { "wood-pile-1": "yes", "dry-brush-1": "not_checked", "fence-joint-1": "yes" } as const;

describe("observe on test yard 2", () => {
  let observed: ReturnType<typeof observe> | undefined;
  const result = () => (observed ??= yard(yardTracks()));

  it("gives one observation per hazard with its truth band", () => {
    const { kept } = result();
    expect(kept.map((k) => k.observation.concept).sort()).toEqual(HAZARDS.map((h) => h.concept).sort());
    for (const hazard of HAZARDS) {
      const found = kept.find((k) => k.observation.concept === hazard.concept)!;
      expect(bandFor(found.observation.distanceFeet), hazard.id).toBe(hazard.truthBand);
      expect(found.trackIds).toEqual([hazardTrack(hazard, HAZARDS.indexOf(hazard) + 1).id]);
      expect(found.observation.plantState).toBeNull();
      expect(found.observation.spacing).toBeNull();
      expect(found.observation.flags).toEqual([]);
    }
  });

  it("finds the wood pile and the fence touching the wall, and leaves the dry brush in front of it not checked", () => {
    const { kept } = result();
    for (const hazard of HAZARDS) {
      const found = kept.find((k) => k.observation.concept === hazard.concept)!;
      expect(found.observation.contact, hazard.id).toBe(TRUTH_CONTACT[hazard.id as keyof typeof TRUTH_CONTACT]);
    }
    const fence = kept.find((k) => k.observation.concept === "wooden_fence")!;
    expect(fence.observation.distanceFeet.low).toBe(0);
    expect(fence.observation.distanceFeet.high).toBeGreaterThan(5);
  });

  it("keeps the dry brush at its measured distance, not pulled to the wall", () => {
    const brush = result().kept.find((k) => k.observation.concept === "dry_brush")!;
    expect(brush.observation.distanceFeet.low).toBeGreaterThan(5);
    expect(brush.observation.distanceFeet.high).toBeLessThan(30);
  });

  it("picks a proof frame inside the picture, and its share of the picture", () => {
    for (const { proof, observation, notes } of result().kept) {
      expect(proof.inside).toBe(true);
      expect(inside(proof.box)).toBe(true);
      expect(proof.clipId).toBe(LOOP_CLIP.id);
      const [x0, y0, x1, y1] = proof.box;
      expect(observation.frameShare).toBeCloseTo((x1 - x0) * (y1 - y0), 10);
      expect(observation.confidence).toBe(0.9);
      expect(notes).toEqual([]);
    }
  });

  it("drops the wall with its reason", () => {
    expect(result().dropped).toEqual([{ trackIds: [trackId(99)], reason: "a house_wall places other objects and is never a finding" }]);
  });
});

const W: [number, number, number, number] = [0, 0.3, 1, 0.5];
const walls = (frames: number[]) => new Map(frames.map((f) => [f, W]));
const at = (frames: number[], box: [number, number, number, number]) => frames.map((frame) => ({ frame, box, confidence: 0.9 }));

describe("contactOf", () => {
  it("is yes when the bottom sits on the wall's base on two frames", () => {
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.49 + CONTACT_MARGIN]), walls([1, 2]))).toBe("yes");
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.51 - CONTACT_MARGIN]), walls([1, 2]))).toBe("yes");
  });

  it("is yes for a fence spanning the base, and not checked for a tall plant doing the same", () => {
    expect(contactOf("wooden_fence", at([1, 2], [0, 0.1, 0.3, 0.9]), walls([1, 2]))).toBe("yes");
    expect(contactOf("shrub", at([1, 2], [0, 0.1, 0.3, 0.9]), walls([1, 2]))).toBe("not_checked");
  });

  it("is no for a box clear of the base", () => {
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.6, 0.4, 0.9]), walls([1, 2]))).toBe("no");
    expect(contactOf("wooden_fence", at([1, 2], [0.2, 0.51, 0.4, 0.5 + CONTACT_MARGIN + 0.01]), walls([1, 2]))).toBe("no");
  });

  it("is not checked without a wall beside it on two frames", () => {
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.5]), walls([1]))).toBe("not_checked");
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.5]), new Map())).toBe("not_checked");
    const narrow = new Map([1, 2].map((f) => [f, [0.6, 0.3, 0.9, 0.5] as [number, number, number, number]]));
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.5]), narrow)).toBe("not_checked");
  });

  it("needs two touching frames, not one", () => {
    const frames = [...at([1], [0.2, 0.2, 0.4, 0.5]), ...at([2], [0.2, 0.6, 0.4, 0.9])];
    expect(contactOf("wood_pile", frames, walls([1, 2]))).toBe("no");
  });

  it("is yes for a bottom exactly the contact margin from the wall's base", () => {
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.5 - CONTACT_MARGIN]), walls([1, 2]))).toBe("yes");
  });

  it("does not count a fence whose top sits exactly on the base as spanning it", () => {
    expect(contactOf("wooden_fence", at([1, 2], [0.2, 0.5, 0.4, 0.9]), walls([1, 2]))).toBe("no");
  });

  it("needs two frames of one kind: one frame on the base and one spanning it is no", () => {
    const frames = [...at([1], [0.2, 0.2, 0.4, 0.5]), ...at([2], [0.2, 0.2, 0.4, 0.9])];
    expect(contactOf("wooden_fence", frames, walls([1, 2]))).toBe("no");
  });

  it("does not count a box that only touches the wall's side edge as beside it", () => {
    const narrow = new Map([1, 2].map((f) => [f, [0.4, 0.3, 0.9, 0.5] as [number, number, number, number]]));
    expect(contactOf("wood_pile", at([1, 2], [0.2, 0.2, 0.4, 0.5]), narrow)).toBe("not_checked");
    expect(contactOf("wood_pile", at([1, 2], [0.9, 0.2, 1, 0.5]), narrow)).toBe("not_checked");
  });
});

describe("observe drops what it cannot use", () => {
  const pile = HAZARDS.find((h) => h.concept === "wood_pile")!;

  it("drops a track seen on one frame, or below the confidence floor", () => {
    const one = hazardTrack(pile, 1);
    one.frames = one.frames.slice(100, 101);
    const faint = hazardTrack(pile, 2, MIN_CONFIDENCE - 0.01);
    const { kept, dropped } = yard([one, faint, wallTrack(99)]);
    expect(kept).toEqual([]);
    const reason = "seen on fewer than 2 frames at confidence 0.5 or more";
    expect(dropped).toContainEqual({ trackIds: [trackId(1)], reason });
    expect(dropped).toContainEqual({ trackIds: [trackId(2)], reason });
  });

  it("keeps a track at the confidence floor", () => {
    expect(yard([hazardTrack(pile, 1, MIN_CONFIDENCE), wallTrack(99)]).kept).toHaveLength(1);
  });

  it("drops a wall or a chimney alone, and an object with no wall to measure from", () => {
    const chimney: Track = { ...wallTrack(3), concept: "chimney" };
    const { kept, dropped } = yard([chimney, hazardTrack(pile, 1)]);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([
      { trackIds: [trackId(3)], reason: "a chimney places other objects and is never a finding" },
      { trackIds: [trackId(1)], reason: UNMEASURED },
    ]);
  });

  it("drops an object with no motion sample near its frames, never guessing a tilt", () => {
    const tracks = [hazardTrack(pile, 1), wallTrack(99)];
    expect(yard(tracks).kept).toHaveLength(1);
    const { kept, dropped } = observe({ clips: [LOOP_CLIP], tracks, tags: [{ ...LOOP_TAG, samples: [] }], startByClip: { [LOOP_CLIP.id]: 0 } });
    expect(kept).toEqual([]);
    expect(dropped).toContainEqual({ trackIds: [trackId(1)], reason: UNMEASURED });
  });
});

describe("observe refuses what is malformed", () => {
  const pile = HAZARDS.find((h) => h.concept === "wood_pile")!;

  it("throws on a track from a clip not given", () => {
    const stray = { ...hazardTrack(pile, 1), clipId: "00000000-0000-4000-8000-0000000000c9" };
    expect(() => yard([stray])).toThrow(/clip not given/);
  });

  it("throws on a clip with no start in the walk", () => {
    expect(() => observe({ clips: [LOOP_CLIP], tracks: [hazardTrack(pile, 1)], tags: [LOOP_TAG], startByClip: {} })).toThrow(/no start/);
  });

  it("throws on a repeated track id", () => {
    expect(() => yard([hazardTrack(pile, 1), hazardTrack(pile, 1)])).toThrow(/its own id/);
  });

  it(`throws on a ${MAX_TRACKS + 1}th merged track, and keeps ${MAX_TRACKS}`, () => {
    const loops = (count: number) => Array.from({ length: count }, (_, i) => flatTrack(i + 1, "loop", "shed", OUT));
    expect(flat({ tracks: [...loops(MAX_TRACKS - 1), wall(), flatTrack(50, "pan", "shed", OUT)], panTilt: 60 }).kept[0]!.trackIds).toHaveLength(MAX_TRACKS);
    expect(() => flat({ tracks: [...loops(MAX_TRACKS), wall(), flatTrack(50, "pan", "shed", OUT)], panTilt: 60 })).toThrow(/at most 16 tracks: 17/);
  });
});

type Box = [number, number, number, number];
const FRAMES = [0, 1, 2, 3];
const FAR_WALL: Box = [0, 0.1, 1, 0.35];
const OUT: Box = [0.3, 0.4, 0.5, 0.5];
const pan: Clip = { ...LOOP_CLIP, id: "00000000-0000-4000-8000-0000000000c2", kind: "pan", file: "clips/test/pan.mp4" };
const loop: Clip = { ...LOOP_CLIP, id: "00000000-0000-4000-8000-0000000000c3", file: "clips/test/loop.mp4" };
const samples = (from: number, tiltDegrees: number, headingDegrees: number) =>
  Array.from({ length: 20 }, (_, i) => ({ t: from + i / 10, tiltDegrees, headingDegrees }));
const flatTrack = (n: number, kind: "loop" | "pan", concept: Track["concept"], box: Box, frames = FRAMES): Track => ({
  id: trackId(n),
  clipId: kind === "loop" ? loop.id : pan.id,
  concept,
  samObjectId: n,
  frames: frames.map((frame) => ({ frame, box, mask: null, confidence: 0.8 })),
});
const wall = (box: Box = FAR_WALL) => flatTrack(99, "loop", "house_wall", box);
type Flat = { tracks: Track[]; loopTilt?: number; loopHeading?: number; panTilt?: number; panHeading?: number; line?: number | null; lineT?: number; panClip?: Clip };
const flatInput = (o: Flat): ObserveInput => ({
  clips: [loop, o.panClip ?? pan],
  tracks: o.tracks,
  tags: [
    { ...LOOP_TAG, startSeconds: 0, endSeconds: 2, samples: samples(0, o.loopTilt ?? 10, o.loopHeading ?? 180) },
    {
      ...LOOP_TAG,
      id: "00000000-0000-4000-8000-0000000000a2",
      kind: "pan",
      startSeconds: 10,
      endSeconds: 12,
      samples: samples(10, o.panTilt ?? 10, o.panHeading ?? 0),
      propertyLine: o.line === undefined || o.line === null ? null : { t: o.lineT ?? 10.5, at: { x: 0.5, y: o.line } },
    },
  ],
  startByClip: { [loop.id]: 0, [pan.id]: 10 },
});
const flat = (o: Flat) => observe(flatInput(o));
const framed = (n: number, concept: Track["concept"], boxes: [number, Box, number?][]): Track => ({
  ...flatTrack(n, "loop", concept, OUT),
  frames: boxes.map(([frame, box, confidence]) => ({ frame, box, mask: null, confidence: confidence ?? 0.8 })),
});
const distanceAt = (y: number, frames = FRAMES) => flat({ tracks: [wall(), flatTrack(1, "loop", "shed", [0.3, 0.4, 0.5, y], frames)] }).kept[0]!.observation.distanceFeet;

describe("observe merges a loop and a pan sighting", () => {
  it("joins the same concept with overlapping distances, the pan looking back the other way", () => {
    const { kept } = flat({ tracks: [flatTrack(1, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "shed", OUT)], panTilt: 60 });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.trackIds).toEqual([trackId(2), trackId(1)]);
    expect(kept[0]!.notes).toEqual(["no property line was tapped, so everything in the pan is kept"]);
  });

  it("keeps them apart when the headings disagree, the concepts differ or the distances do not overlap", () => {
    expect(flat({ tracks: [flatTrack(1, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "shed", OUT)], panTilt: 60, panHeading: 90 }).kept).toHaveLength(2);
    expect(flat({ tracks: [flatTrack(1, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "tree", OUT)], panTilt: 60 }).kept).toHaveLength(2);
    const between: Box = [0.3, 0.7, 0.5, 0.8];
    const apart = [flatTrack(1, "loop", "shed", between), wall([0, 0.1, 1, 0.6]), flatTrack(2, "pan", "shed", [0.3, 0.6, 0.5, 0.9])];
    expect(flat({ tracks: apart, panTilt: 10 }).kept).toHaveLength(2);
  });

  it("joins two pan sightings through one loop sighting, and two loop sightings through one pan", () => {
    const { kept } = flat({ tracks: [flatTrack(1, "loop", "shed", OUT), flatTrack(3, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "shed", OUT)], panTilt: 60 });
    expect(kept).toHaveLength(1);
    expect([...kept[0]!.trackIds].sort()).toEqual([trackId(1), trackId(2), trackId(3)]);
  });
});

describe("observe places pan objects from the loop's wall", () => {
  it("drops a pan object when the loop saw no wall", () => {
    const { kept, dropped } = flat({ tracks: [flatTrack(2, "pan", "shed", OUT)] });
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ trackIds: [trackId(2)], reason: "no wall in the loop, so a pan object cannot be placed" }]);
  });

  it("drops an object more than 100 feet out", () => {
    const edge: Box = [0.3, 0.2, 0.5, 0.31];
    const { kept, dropped } = flat({ tracks: [wall([0, 0.1, 1, 0.31]), flatTrack(2, "pan", "shed", edge)] });
    expect(kept).toEqual([]);
    expect(dropped).toContainEqual({ trackIds: [trackId(2)], reason: "more than 100 feet from the house" });
  });

  it("drops a pan object past the tapped property line, and keeps one before it", () => {
    const near: Box = [0.3, 0.6, 0.5, 0.9];
    const tracks = [wall([0, 0.1, 1, 0.6]), flatTrack(2, "pan", "shed", OUT)];
    expect(flat({ tracks, line: 0.95 }).dropped).toContainEqual({ trackIds: [trackId(2)], reason: "past the property line" });
    const kept = flat({ tracks, line: 0.35 }).kept;
    expect(kept).toHaveLength(1);
    expect(kept[0]!.notes).toEqual([]);
    expect(flat({ tracks: [wall([0, 0.1, 1, 0.6]), flatTrack(2, "pan", "shed", near)], line: 0.95 }).kept).toHaveLength(1);
  });

  it("puts a pan object farther out than the wall's distance from the camera", () => {
    const { kept } = flat({ tracks: [wall([0, 0.1, 1, 0.6]), flatTrack(2, "pan", "shed", OUT)] });
    const home = kept[0]!.observation.distanceFeet;
    expect(home.low).toBeGreaterThan(25);
    expect(kept[0]!.observation.contact).toBe("not_checked");
  });
});

describe("observe flags and proof frames", () => {
  const branch = (box: Box) => flatTrack(1, "loop", "tree_branch_over_roof", box);
  const chimney = (box: Box) => flatTrack(5, "loop", "chimney", box);
  const WALL: Box = [0, 0.1, 1, 0.6];

  it("flags a branch within 10 feet of a chimney on two frames", () => {
    const { kept } = flat({ tracks: [wall(WALL), branch([0.1, 0.45, 0.3, 0.55]), chimney([0.5, 0.1, 0.6, 0.3])] });
    expect(kept[0]!.observation.flags).toEqual(["near_chimney"]);
    expect(flat({ tracks: [wall(WALL), branch([0.1, 0.45, 0.3, 0.55]), chimney([0.25, 0.1, 0.6, 0.3])] }).kept[0]!.observation.flags).toEqual(["near_chimney"]);
  });

  it("does not flag a branch far from the chimney, on one frame only, or a shrub beside it", () => {
    expect(flat({ tracks: [wall(WALL), branch([0.05, 0.45, 0.1, 0.55]), chimney([0.8, 0.1, 0.9, 0.3])] }).kept[0]!.observation.flags).toEqual([]);
    const once = flatTrack(5, "loop", "chimney", [0.5, 0.1, 0.6, 0.3], [0]);
    expect(flat({ tracks: [wall(WALL), branch([0.1, 0.45, 0.3, 0.55]), once] }).kept[0]!.observation.flags).toEqual([]);
    const shrub = flatTrack(1, "loop", "shrub", [0.1, 0.45, 0.3, 0.55]);
    expect(flat({ tracks: [wall(WALL), shrub, chimney([0.5, 0.1, 0.6, 0.3])] }).kept[0]!.observation.flags).toEqual([]);
  });

  it("picks the most confident frame inside the picture, ties to the larger box", () => {
    const track = flatTrack(1, "loop", "shed", OUT);
    track.frames[1] = { ...track.frames[1]!, confidence: 0.95, box: [0, 0.4, 0.2, 0.5] };
    track.frames[2] = { ...track.frames[2]!, confidence: 0.9 };
    track.frames[3] = { ...track.frames[3]!, confidence: 0.9, box: [0.3, 0.38, 0.5, 0.5] };
    const { proof, observation } = flat({ tracks: [wall(), track] }).kept[0]!;
    expect(proof).toEqual({ clipId: loop.id, frame: 3, box: [0.3, 0.38, 0.5, 0.5], confidence: 0.9, inside: true });
    expect(observation.confidence).toBe(0.9);
  });

  it("falls back to the most confident frame, noted, when every box touches the edge", () => {
    const track = flatTrack(1, "loop", "shed", [0, 0.4, 0.2, 0.5]);
    track.frames[2] = { ...track.frames[2]!, confidence: 0.95 };
    const { proof, notes } = flat({ tracks: [wall(), track] }).kept[0]!;
    expect(proof).toMatchObject({ frame: 2, inside: false });
    expect(notes).toEqual(["placed on frames cut off by the picture's edge", "the proof frame touches the picture's edge"]);
  });

  it("counts a box exactly at the edge margin, on any of its four sides, as touching the edge", () => {
    const edges: Box[] = [
      [EDGE_MARGIN, 0.4, 0.2, 0.5],
      [0.3, EDGE_MARGIN, 0.5, 0.5],
      [0.8, 0.4, 1 - EDGE_MARGIN, 0.5],
      [0.3, 0.4, 0.5, 1 - EDGE_MARGIN],
    ];
    for (const box of edges) expect(flat({ tracks: [wall(), flatTrack(1, "loop", "shed", box)] }).kept[0]!.proof.inside, String(box)).toBe(false);
  });

  it("keeps the first of equally good frames, and never trades confidence for a bigger box", () => {
    const track = framed(1, "shed", [
      [0, OUT, 0.9],
      [1, [0.1, 0.3, 0.6, 0.5], 0.8],
      [2, OUT, 0.9],
      [3, [0.3, 0.45, 0.4, 0.5], 0.9],
    ]);
    expect(flat({ tracks: [wall(), track] }).kept[0]!.proof.frame).toBe(0);
  });

  it("flags a branch near the chimney on exactly two frames", () => {
    const twice = flatTrack(5, "loop", "chimney", [0.5, 0.1, 0.6, 0.3], [0, 1]);
    expect(flat({ tracks: [wall(WALL), branch([0.1, 0.45, 0.3, 0.55]), twice] }).kept[0]!.observation.flags).toEqual(["near_chimney"]);
  });

  it("flags a branch at exactly 10 feet from the chimney, and not one a step past it", () => {
    const beside = (x: number) => flat({ tracks: [wall(WALL), branch([0.1, 0.45, 0.3, 0.55]), chimney([x, 0.1, 0.999, 0.3])] }).kept[0]!.observation.flags;
    expect(beside(0.8161503025716126)).toEqual(["near_chimney"]);
    expect(beside(0.8161503025716127)).toEqual([]);
  });

  it("does not count a chimney beside the branch on frames where no wall gives the scale", () => {
    const wallTwice = flatTrack(99, "loop", "house_wall", WALL, [0, 1]);
    const late = flatTrack(5, "loop", "chimney", [0.5, 0.1, 0.6, 0.3], [1, 2, 3]);
    expect(flat({ tracks: [wallTwice, branch([0.1, 0.45, 0.3, 0.55]), late] }).kept[0]!.observation.flags).toEqual([]);
  });
});

describe("observe measures each object by the median of its frames", () => {
  it("takes the middle frame's distance from three frames given out of order", () => {
    const track = framed(1, "shed", [
      [0, [0.3, 0.4, 0.5, 0.5]],
      [1, [0.3, 0.4, 0.5, 0.45]],
      [2, [0.3, 0.4, 0.5, 0.55]],
    ]);
    expect(flat({ tracks: [wall(), track] }).kept[0]!.observation.distanceFeet).toEqual(distanceAt(0.5));
  });

  it("puts an object seen on two frames halfway between them", () => {
    const near = distanceAt(0.55, [0, 1]);
    const far = distanceAt(0.45, [0, 1]);
    const track = framed(1, "shed", [
      [0, [0.3, 0.4, 0.5, 0.45]],
      [1, [0.3, 0.4, 0.5, 0.55]],
    ]);
    expect(flat({ tracks: [wall(), track] }).kept[0]!.observation.distanceFeet).toEqual({ low: (far.low + near.low) / 2, high: (far.high + near.high) / 2 });
  });

  it("keeps a track seen on exactly two confident frames", () => {
    expect(flat({ tracks: [wall(), flatTrack(1, "loop", "shed", OUT, [0, 1])] }).kept).toHaveLength(1);
  });

  it("gives each frame the same motion sample whatever order the tags arrive in, the earlier sample winning a tie", () => {
    const tag = (t: number, tiltDegrees: number): Tag => ({ ...LOOP_TAG, startSeconds: 0, endSeconds: 2, samples: [{ t, tiltDegrees, headingDegrees: 180 }] });
    const run = (tags: Tag[]) =>
      observe({ clips: [loop], tracks: [flatTrack(99, "loop", "house_wall", FAR_WALL, [0, 1]), flatTrack(1, "loop", "shed", OUT, [0, 1])], tags, startByClip: { [loop.id]: 0.75 } });
    const early = tag(0.5, 10);
    const late = tag(1, 20);
    expect(run([early, late]).kept).toHaveLength(1);
    expect(run([late, early])).toEqual(run([early, late]));
  });

  it("places an object filmed straight down, and drops one whose tilt reads past straight down", () => {
    expect(flat({ tracks: [wall(), flatTrack(1, "loop", "shed", OUT)], loopTilt: 90 }).kept).toHaveLength(1);
    const past = flat({ tracks: [wall(), flatTrack(1, "loop", "shed", OUT)], loopTilt: 120 });
    expect(past.kept).toEqual([]);
    expect(past.dropped).toContainEqual({ trackIds: [trackId(1)], reason: UNMEASURED });
  });
});

describe("observe joins at the edges of its rules", () => {
  const STRAIGHT_DOWN: Box = [0.3, 0.4, 0.5, 0.9];

  it("joins a loop facing east with a pan facing west", () => {
    const tracks = [flatTrack(1, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "shed", OUT)];
    expect(flat({ tracks, panTilt: 60, loopHeading: 90, panHeading: 270 }).kept).toHaveLength(1);
  });

  it("joins at exactly 30 degrees off facing each other", () => {
    const tracks = [flatTrack(1, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "shed", OUT)];
    expect(flat({ tracks, panTilt: 60, panHeading: 30 }).kept).toHaveLength(1);
  });

  it("joins a loop and a pan sighting whose distances only touch, both at zero feet straight down", () => {
    const tracks = [wall([0, 0.1, 1, 0.9]), flatTrack(1, "loop", "shed", STRAIGHT_DOWN), flatTrack(2, "pan", "shed", STRAIGHT_DOWN)];
    const { kept } = flat({ tracks, loopTilt: 90, panTilt: 90 });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.observation.distanceFeet).toEqual({ low: 0, high: 0 });
  });

  it("keeps a pan object exactly at the property line's distance", () => {
    const tracks = [wall([0, 0.1, 1, 0.9]), flatTrack(2, "pan", "shed", STRAIGHT_DOWN)];
    expect(flat({ tracks, loopTilt: 90, panTilt: 90, line: 0.9 }).kept).toHaveLength(1);
  });
});

describe("observe reads the property line", () => {
  const tracks = () => [wall([0, 0.1, 1, 0.6]), flatTrack(2, "pan", "shed", OUT)];

  it("from whichever pan tag carries it", () => {
    const input = flatInput({ tracks: tracks(), line: 0.95 });
    const [loopTag, panTag] = input.tags;
    const result = observe({ ...input, tags: [loopTag!, { ...panTag!, propertyLine: null }, panTag!] });
    expect(result.dropped).toContainEqual({ trackIds: [trackId(2)], reason: "past the property line" });
  });

  it("with the pan clip's own field of view when the pan is filmed upright", () => {
    const upright: Clip = { ...pan, width: LOOP_CLIP.height, height: LOOP_CLIP.width };
    const high: Box = [0.3, 0.1, 0.5, 0.2];
    const result = flat({ tracks: [wall([0, 0.1, 1, 0.6]), flatTrack(2, "pan", "shed", high)], panClip: upright, panTilt: 40, line: 0.2 });
    expect(result.kept).toHaveLength(1);
  });

  it("and ignores a line tapped where no motion sample is near, keeping the pan object", () => {
    const { kept } = flat({ tracks: tracks(), line: 0.95, lineT: 30 });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.notes).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { Clip, Tag, Track } from "@emberwalk/shared";
import { bandFor, CAMERA_HEIGHT_FEET, NOT_MEASURED, CONTACT_MARGIN, contactOf, EDGE_MARGIN, groundFeet, HOUSE_AS_SHED, LONG_SIDE_FOV_DEGREES, MAX_TRACKS, verticalFov, MIN_CONFIDENCE, observe, type ObserveInput, picksUp } from "../src/index.ts";
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
  it("is yes for a box on the right half of the wall, as for one on the left half", () => {
    expect(contactOf("wood_pile", at([1, 2], [0.7, 0.2, 0.9, 0.5]), walls([1, 2]))).toBe("yes");
    expect(contactOf("wood_pile", at([1, 2], [0.1, 0.2, 0.3, 0.5]), walls([1, 2]))).toBe("yes");
  });

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

  it("drops a wall alone, and an object with no wall to measure from", () => {
    expect(yard([wallTrack(3)])).toEqual({ kept: [], dropped: [{ trackIds: [trackId(3)], reason: "a house_wall places other objects and is never a finding" }] });
    const { kept, dropped } = yard([hazardTrack(pile, 1)]);
    expect(kept).toEqual([]);
    expect(dropped).toEqual([{ trackIds: [trackId(1)], reason: UNMEASURED }]);
  });

  it("keeps a chimney seen on two frames as a Zone 0 observation with no branch flag, with or without a wall", () => {
    const chimney: Track = { ...wallTrack(3), concept: "chimney" };
    for (const tracks of [[chimney], [chimney, wallTrack(99)]]) {
      const { kept, dropped } = yard(tracks);
      expect(dropped.every((d) => d.trackIds[0] === trackId(99))).toBe(true);
      expect(kept.map((k) => [k.trackIds, k.observation.concept, k.observation.distanceFeet, k.observation.contact, k.observation.flags])).toEqual([
        [[trackId(3)], "chimney", { low: 0, high: 0 }, "not_checked", []],
      ]);
    }
  });

  it("keeps a wood deck seen on two frames at the house, since a deck is built onto it, with or without a wall", () => {
    const deck: Track = { ...wallTrack(3), concept: "wood_deck" };
    for (const tracks of [[deck], [deck, wallTrack(99)]]) {
      const { kept } = yard(tracks);
      expect(kept.map((k) => [k.trackIds, k.observation.concept, k.observation.distanceFeet, k.observation.contact])).toEqual([
        [[trackId(3)], "wood_deck", { low: 0, high: 0 }, "not_checked"],
      ]);
    }
  });

  describe("a roof line thing seen wholly above the horizon", () => {
    const ROOF: Box = [0.4, 0, 0.7, 0.08];
    const atHouse = (o: Flat) => flat(o).kept.map((k) => [k.trackIds, k.observation.concept, k.observation.distanceFeet, bandFor(k.observation.distanceFeet)]);

    it("is placed at the house in Zone 0 when it lies over the house's wall: gutter leaves at the wall's top, a branch reaching down into the wall's box", () => {
      expect(atHouse({ tracks: [flatTrack(1, "loop", "roof_debris", ROOF), wall()] })).toEqual([[[trackId(1)], "roof_debris", { low: 0, high: 0 }, "zone_0"]]);
      expect(atHouse({ tracks: [flatTrack(1, "loop", "tree_branch_over_roof", [0.4, 0, 0.7, 0.2]), wall()] })).toEqual([
        [[trackId(1)], "tree_branch_over_roof", { low: 0, high: 0 }, "zone_0"],
      ]);
    });

    it("is placed at the house when a branch reaches down past a chimney's top with no wall in the picture", () => {
      const chimney = flatTrack(5, "loop", "chimney", [0.6, 0.02, 0.65, 0.12]);
      expect(atHouse({ tracks: [flatTrack(1, "loop", "tree_branch_over_roof", [0.4, 0, 0.7, 0.1]), chimney] }).filter(([, concept]) => concept !== "chimney")).toEqual([
        [[trackId(1)], "tree_branch_over_roof", { low: 0, high: 0 }, "zone_0"],
      ]);
    });

    it("never pins a tree behind the house to it: a branch box that stops at the house's top edge is not measured", () => {
      for (const box of [[0.4, 0, 0.7, 0.1], [0.4, 0, 0.7, 0.08], [0.4, 0, 0.7, 0.15]] as Box[]) {
        const { kept, dropped } = flat({ tracks: [flatTrack(1, "loop", "tree_branch_over_roof", box), wall()] });
        expect(kept.filter((k) => k.observation.concept === "tree_branch_over_roof"), String(box)).toEqual([]);
        expect(dropped.filter((d) => d.trackIds[0] === trackId(1)).map((d) => d.reason)).toEqual([NOT_MEASURED]);
      }
    });

    it("is dropped as unmeasured when nothing of the house lies under it, as a far canopy", () => {
      for (const concept of ["roof_debris", "tree_branch_over_roof"] as const) {
        expect(flat({ tracks: [flatTrack(1, "loop", concept, ROOF)] }).dropped).toEqual([{ trackIds: [trackId(1)], reason: UNMEASURED }]);
        const { kept, dropped } = flat({ tracks: [flatTrack(1, "loop", concept, [0.6, 0, 0.9, 0.08]), wall([0, 0.1, 0.3, 0.35])] });
        expect(kept).toEqual([]);
        expect(dropped.filter((d) => d.trackIds[0] === trackId(1)).map((d) => d.reason)).toEqual([UNMEASURED]);
      }
    });

    it("is dropped in a pan, with or without a wall in the loop", () => {
      for (const tracks of [[flatTrack(1, "pan", "tree_branch_over_roof", ROOF)], [flatTrack(1, "pan", "tree_branch_over_roof", ROOF), wall()]])
        expect(flat({ tracks }).kept).toEqual([]);
    });

    it("keeps measuring roof debris and a branch seen at yard level, or partly so, never forcing them to 0 feet", () => {
      for (const concept of ["roof_debris", "tree_branch_over_roof"] as const) {
        const low = flat({ tracks: [flatTrack(1, "loop", concept, [0.4, 0.3, 0.7, 0.45]), wall()] }).kept[0]!.observation.distanceFeet;
        const mixed = flat({ tracks: [framed(1, concept, [[0, ROOF], [1, ROOF], [2, [0.4, 0.3, 0.7, 0.45]], [3, [0.4, 0.3, 0.7, 0.45]]]), wall()] }).kept[0]!.observation.distanceFeet;
        expect(low.high).toBeGreaterThan(0);
        expect(mixed).toEqual(low);
      }
    });
  });

  it("drops a chimney seen on one frame or below the confidence floor, like any other object", () => {
    const one: Track = { ...wallTrack(3), concept: "chimney" };
    one.frames = one.frames.slice(100, 101);
    const faint: Track = { ...wallTrack(4), concept: "chimney", frames: wallTrack(4).frames.map((f) => ({ ...f, confidence: MIN_CONFIDENCE - 0.01 })) };
    const { kept, dropped } = yard([one, faint]);
    expect(kept).toEqual([]);
    expect(dropped.map((d) => d.trackIds)).toEqual([[trackId(3)], [trackId(4)]]);
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

describe("observe joins an object seen again later from the same side", () => {
  const EARLY = [0, 1, 2, 3];
  const LATE = [20, 21, 22, 23].map((s) => s * loop.fps);
  const SECOND_SIDE = [50, 51, 52, 53].map((s) => s * loop.fps);
  const steady = (from: number, to: number) => Array.from({ length: (to - from) * 2 + 1 }, (_, i) => ({ t: from + i / 2, tiltDegrees: 30, headingDegrees: 90 }));
  const sideTag = (n: number, label: string, from: number, to: number): Tag => ({ ...LOOP_TAG, id: trackId(800 + n), label, startSeconds: from, endSeconds: to, samples: steady(from, to) });
  const WALL_FRAMES = [...EARLY, ...LATE, ...SECOND_SIDE];
  const lap = (...tracks: Track[]) =>
    observe({
      clips: [loop],
      tracks: [flatTrack(99, "loop", "house_wall", FAR_WALL, WALL_FRAMES), ...tracks],
      tags: [sideTag(1, "left", 0, 40), sideTag(2, "back", 40, 60)],
      startByClip: { [loop.id]: 0 },
    }).kept;

  it("joins a concept that comes back long after, at the same distance, on the same side", () => {
    expect(lap(flatTrack(1, "loop", "patio_furniture", OUT, EARLY), flatTrack(2, "loop", "patio_furniture", OUT, LATE))).toHaveLength(1);
  });

  it("keeps them apart when the sightings are on different sides of the house", () => {
    expect(lap(flatTrack(1, "loop", "patio_furniture", OUT, EARLY), flatTrack(2, "loop", "patio_furniture", OUT, SECOND_SIDE))).toHaveLength(2);
  });

  it("keeps them apart when their distances do not overlap", () => {
    expect(lap(flatTrack(1, "loop", "patio_furniture", [0.3, 0.35, 0.5, 0.45], EARLY), flatTrack(2, "loop", "patio_furniture", [0.3, 0.85, 0.5, 0.95], LATE))).toHaveLength(2);
  });

  it("joins the pieces of a set seen on one frame, and on one side only", () => {
    const chair = flatTrack(1, "loop", "patio_furniture", OUT, EARLY);
    const table = flatTrack(2, "loop", "patio_furniture", [0.6, 0.4, 0.8, 0.5], EARLY);
    expect(lap(chair, table)).toHaveLength(1);
    expect(lap(chair, flatTrack(2, "loop", "patio_furniture", [0.6, 0.4, 0.8, 0.5], SECOND_SIDE))).toHaveLength(2);
  });

  it("keeps a near piece and a far piece of a set apart, even when their ranges meet", () => {
    const near = flatTrack(1, "loop", "patio_furniture", [0.3, 0.6, 0.5, 1], EARLY);
    const far = flatTrack(2, "loop", "patio_furniture", [0.3, 0.45, 0.5, 0.55], LATE);
    const both = (lap(near, far) as { observation: { distanceFeet: { low: number; high: number } } }[]).map((k) => k.observation.distanceFeet);
    expect(new Set(both.map((d) => bandFor(d))).size).toBe(both.length);
  });

  it("makes dry grass one finding per band around the whole house, since one mowing fixes it, and never joins two bands", () => {
    const left = flatTrack(1, "loop", "dry_grass", OUT, EARLY);
    const back = flatTrack(2, "loop", "dry_grass", OUT, SECOND_SIDE);
    const near = flatTrack(3, "loop", "dry_grass", [0.3, 0.6, 0.5, 1], LATE);
    const far = flatTrack(4, "loop", "dry_grass", [0.3, 0.45, 0.5, 0.55], LATE);
    const kept = lap(left, back, near, far);
    const bands = kept.map((k) => bandFor(k.observation.distanceFeet));
    expect(new Set(bands).size).toBe(bands.length);
    const sameBand = kept.find((k) => k.trackIds.includes(trackId(1)))!;
    expect(sameBand.trackIds).toContain(trackId(2));
  });

  it("keeps two sheds on one frame apart, since they are not a set", () => {
    expect(lap(flatTrack(1, "loop", "shed", OUT, EARLY), flatTrack(2, "loop", "shed", [0.6, 0.4, 0.8, 0.5], EARLY))).toHaveLength(2);
  });

  it("keeps trees and shrubs apart, since a side of a yard often holds several", () => {
    expect(lap(flatTrack(1, "loop", "tree", OUT, EARLY), flatTrack(2, "loop", "tree", OUT, LATE))).toHaveLength(2);
    expect(lap(flatTrack(1, "loop", "shrub", OUT, EARLY), flatTrack(2, "loop", "shrub", OUT, LATE))).toHaveLength(2);
  });
});

describe("observe places an object against the wall behind it", () => {
  const nearWall = flatTrack(98, "loop", "house_wall", [0, 0.1, 0.3, 0.8]);
  const farWall = flatTrack(99, "loop", "house_wall", [0.5, 0.1, 1, 0.5]);
  const place = (...tracks: Track[]) => flat({ tracks, loopTilt: 30 });

  it("measures from the wall in its own column, not a nearer wall elsewhere in the picture", () => {
    const { kept } = place(nearWall, farWall, flatTrack(1, "loop", "patio_furniture", [0.6, 0.5, 0.8, 0.7]));
    expect(kept[0]!.observation.distanceFeet.low).toBeGreaterThan(0);
  });

  it("does not call a thing touching the wall for two frames of many", () => {
    const frames = [0, 1, 2, 3, 4, 5, 6, 7];
    const clear: Box = [0.6, 0.6, 0.8, 0.9];
    const track = { ...flatTrack(1, "loop", "patio_furniture", clear, frames), frames: frames.map((frame, i) => ({ frame, box: (i < 2 ? [0.6, 0.2, 0.8, 0.5] : clear) as Box, mask: null, confidence: 0.8 })) };
    const { kept } = place(flatTrack(99, "loop", "house_wall", [0, 0.1, 1, 0.5], frames), track);
    expect(kept[0]!.observation.contact).toBe("no");
  });

  it("says only how far at least, up to the wall, when the object's foot is below the picture", () => {
    const cut = flat({ tracks: [wall([0, 0.1, 1, 0.5]), flatTrack(1, "loop", "patio_furniture", [0.3, 0.6, 0.5, 1])], loopTilt: 30 }).kept[0]!.observation.distanceFeet;
    const view = { tiltBelowHorizonDegrees: 30, verticalFovDegrees: verticalFov(loop), cameraHeightFeet: CAMERA_HEIGHT_FEET };
    expect(cut.high).toBeCloseTo(groundFeet({ y: 0.5, ...view })!.high, 5);
    expect(cut.low).toBeLessThan(cut.high);
  });

  it("refuses a shed lying inside the house wall, and keeps one standing clear of it", () => {
    const refused = place(wall([0, 0.1, 1, 0.8]), flatTrack(1, "loop", "shed", [0.2, 0.2, 0.6, 0.7]));
    expect(refused.kept).toEqual([]);
    expect(refused.dropped.map((d) => d.reason)).toContain(HOUSE_AS_SHED);
    expect(place(wall([0, 0.1, 1, 0.5]), flatTrack(1, "loop", "shed", [0.2, 0.2, 0.6, 0.7])).kept).toHaveLength(1);
  });

  it("never guesses a distance for a thing seen past the wall's base: it is left unplaced, so not checked", () => {
    const seen = place(wall([0, 0.1, 1, 0.8]), flatTrack(1, "loop", "patio_furniture", [0.3, 0.3, 0.5, 0.5]));
    expect(seen.kept).toEqual([]);
    expect(seen.dropped.map((d) => d.reason)).toContain(NOT_MEASURED);
  });

  it("never guesses a distance for a thing with no wall in its own column: it is left unplaced, so not checked", () => {
    const seen = place(nearWall, flatTrack(1, "loop", "patio_furniture", [0.6, 0.5, 0.8, 0.7]));
    expect(seen.kept).toEqual([]);
    expect(seen.dropped.map((d) => d.reason)).toContain(NOT_MEASURED);
  });

  it("says between the wall and the camera, never exactly 0 feet, for a thing whose foot sits on the wall's base", () => {
    const seen = place(wall([0, 0.1, 1, 0.5]), flatTrack(1, "loop", "patio_furniture", [0.3, 0.3, 0.5, 0.5])).kept[0]!.observation.distanceFeet;
    expect(seen.low).toBe(0);
    expect(seen.high).toBeGreaterThan(0);
  });

  it("does not keep a tree or a shed with no wall in its own column, since either can stand past the house", () => {
    for (const concept of ["tree", "shed"] as const) expect(place(nearWall, flatTrack(1, "loop", concept, [0.6, 0.5, 0.8, 0.7])).kept, concept).toEqual([]);
  });

  it("gives a pan object whose foot is below the picture no floor, so it stays in the first band", () => {
    const { kept } = flat({ tracks: [wall(), flatTrack(1, "pan", "patio_furniture", [0.3, 0.6, 0.5, 1])], panTilt: 30, loopTilt: 30 });
    expect(kept[0]!.observation.distanceFeet.low).toBe(0);
    expect(bandFor(kept[0]!.observation.distanceFeet)).toBe("zone_0");
  });

  it("calls a pile rising past the wall's base with its foot just in front of the wall a touch", () => {
    const { kept } = place(wall([0, 0.1, 1, 0.74]), flatTrack(1, "loop", "wood_pile", [0.3, 0.3, 0.6, 0.83]));
    expect(kept[0]!.observation.contact).toBe("yes");
    expect(kept[0]!.observation.distanceFeet.low).toBe(0);
  });

  it("does not call a pile a touch when its foot stands well out from the wall", () => {
    const { kept } = place(wall([0, 0.1, 1, 0.5]), flatTrack(1, "loop", "wood_pile", [0.3, 0.3, 0.6, 0.95]));
    expect(kept[0]!.observation.contact).not.toBe("yes");
  });

  it("does not call a shrub rising past the wall's base a touch, since a shrub has no such depth", () => {
    const { kept } = place(wall([0, 0.1, 1, 0.74]), flatTrack(1, "loop", "shrub", [0.3, 0.3, 0.6, 0.83]));
    expect(kept[0]!.observation.contact).not.toBe("yes");
  });

  it("keeps a shed mostly but not wholly inside the wall's box", () => {
    const { kept } = place(wall([0, 0.1, 1, 0.8]), flatTrack(1, "loop", "shed", [0.2, 0.2, 0.6, 0.86]));
    expect(kept).toHaveLength(1);
  });

  it("drops a touch the distance says against, and keeps the distance", () => {
    const panWall = flatTrack(98, "pan", "house_wall", [0, 0.1, 1, 0.9]);
    const { kept } = flat({ tracks: [wall(), panWall, flatTrack(1, "pan", "patio_furniture", [0.3, 0.3, 0.5, 0.9])], panTilt: 30 });
    expect(kept[0]!.observation.contact).not.toBe("yes");
    expect(kept[0]!.observation.distanceFeet.low).toBeGreaterThan(5);
  });

  it("never calls anything else lying inside the wall part of the house", () => {
    const { dropped } = place(wall([0, 0.1, 1, 0.8]), flatTrack(1, "loop", "patio_furniture", [0.2, 0.2, 0.6, 0.7]));
    expect(dropped.map((d) => d.reason)).not.toContain(HOUSE_AS_SHED);
    expect(dropped.map((d) => d.reason)).toContain(NOT_MEASURED);
  });
});

describe("observe measures with the lens it is given", () => {
  const seen = (lens?: number) =>
    observe({ ...flatInput({ tracks: [wall([0, 0.1, 1, 0.75]), flatTrack(1, "loop", "shed", [0.3, 0.4, 0.5, 0.95])], loopTilt: 30 }), ...(lens === undefined ? {} : { longSideFovDegrees: lens }) }).kept[0]!.observation.distanceFeet;

  it("uses the phone lens when none is given", () => {
    expect(seen()).toEqual(seen(LONG_SIDE_FOV_DEGREES));
  });

  it("measures a different distance through a wider lens", () => {
    expect(seen(84)).not.toEqual(seen());
  });
});

describe("observe joins repeated sightings of one object", () => {
  const LATER = [10, 11, 12, 13];
  const walled = (...tracks: Track[]) => [wallAll(), ...tracks];
  const wallAll = (): Track => flatTrack(99, "loop", "house_wall", FAR_WALL, [...FRAMES, ...LATER]);

  it("joins one concept seen at different times in a clip, looking the same way at the same distance", () => {
    const { kept } = flat({ tracks: walled(flatTrack(1, "loop", "shed", OUT), flatTrack(2, "loop", "shed", OUT, LATER)) });
    expect(kept).toHaveLength(1);
    expect([...kept[0]!.trackIds].sort()).toEqual([trackId(1), trackId(2)]);
  });

  it("keeps two of a concept seen on the same frame apart, since they are two objects", () => {
    expect(flat({ tracks: walled(flatTrack(1, "loop", "shed", OUT), flatTrack(2, "loop", "shed", [0.6, 0.4, 0.8, 0.5])) }).kept).toHaveLength(2);
  });

  it("keeps them apart when their distances do not overlap", () => {
    const tracks = walled(flatTrack(1, "loop", "shed", [0.3, 0.3, 0.5, 0.4]), flatTrack(2, "loop", "shed", [0.3, 0.85, 0.5, 0.95], LATER));
    expect(flat({ tracks, loopTilt: 30 }).kept).toHaveLength(2);
  });

  it("keeps them apart when they are in different clips of the same heading", () => {
    const { kept } = flat({ tracks: walled(flatTrack(1, "loop", "shed", OUT), flatTrack(2, "pan", "shed", OUT)), panTilt: 60, panHeading: 180 });
    expect(kept).toHaveLength(2);
  });

  it("never joins past the limit on tracks, and never fails for it", () => {
    const tracks = Array.from({ length: MAX_TRACKS + 2 }, (_, i) => flatTrack(i + 1, "loop", "shed", OUT, [i * 2, i * 2 + 1]));
    const wallEvery = flatTrack(99, "loop", "house_wall", FAR_WALL, Array.from({ length: (MAX_TRACKS + 2) * 2 }, (_, i) => i));
    const { kept } = flat({ tracks: [wallEvery, ...tracks] });
    expect(kept.flatMap((k) => k.trackIds)).toHaveLength(MAX_TRACKS + 2);
    for (const k of kept) expect(k.trackIds.length).toBeLessThanOrEqual(MAX_TRACKS);
  });

  it("counts a lumber pile on the same box as a wood pile as that wood pile", () => {
    const { kept } = flat({ tracks: walled(flatTrack(1, "loop", "lumber_pile", OUT), flatTrack(2, "loop", "wood_pile", OUT)) });
    expect(kept).toHaveLength(1);
    expect(kept[0]!.observation.concept).toBe("wood_pile");
    expect([...kept[0]!.trackIds].sort()).toEqual([trackId(1), trackId(2)]);
  });

  it("keeps a lumber pile's wall contact and its distance when it joins a wood pile", () => {
    const lumber = flatTrack(1, "loop", "lumber_pile", [0.3, 0.2, 0.5, 0.35]);
    const pile = flatTrack(2, "loop", "wood_pile", [0.3, 0.2, 0.5, 0.48]);
    const alone = flat({ tracks: walled(pile), loopTilt: 10 }).kept[0]!.observation;
    const { kept } = flat({ tracks: walled(lumber, pile), loopTilt: 10 });
    expect(kept).toHaveLength(1);
    expect(alone.contact).not.toBe("yes");
    expect(kept[0]!.observation.contact).toBe("yes");
    expect(kept[0]!.observation.distanceFeet.low).toBe(0);
    expect(kept[0]!.observation.distanceFeet.high).toBeGreaterThanOrEqual(alone.distanceFeet.high);
  });

  it("never joins lumber piles to a wood pile past the limit on tracks", () => {
    const lumber = Array.from({ length: MAX_TRACKS + 1 }, (_, i) => flatTrack(i + 1, "loop", "lumber_pile", OUT));
    const { kept } = flat({ tracks: walled(flatTrack(50, "loop", "wood_pile", OUT), ...lumber) });
    expect(kept.flatMap((k) => k.trackIds)).toHaveLength(MAX_TRACKS + 2);
    for (const k of kept) expect(k.trackIds.length).toBeLessThanOrEqual(MAX_TRACKS);
  });

  it("keeps two wood piles apart when the second appears elsewhere in the picture, not where the first left", () => {
    const { kept } = flat({ tracks: walled(flatTrack(1, "loop", "wood_pile", [0.05, 0.4, 0.2, 0.5]), flatTrack(2, "loop", "wood_pile", [0.75, 0.4, 0.9, 0.5], LATER)) });
    expect(kept).toHaveLength(2);
  });

  it("joins a sighting that picks up where the last left off, in time and in the picture", () => {
    const box: Box = [0.3, 0.4, 0.5, 0.5];
    const near: Box = [0.35, 0.4, 0.55, 0.5];
    const far: Box = [0.75, 0.4, 0.95, 0.5];
    expect(picksUp({ frame: 3, box }, { frame: 5, box: near }, 2)).toBe(true);
    expect(picksUp({ frame: 3, box }, { frame: 5, box: far }, 2)).toBe(false);
    expect(picksUp({ frame: 3, box }, { frame: 3 + 2 * 60, box: near }, 2)).toBe(false);
  });

  it("keeps a lumber pile apart from a wood pile elsewhere in the picture", () => {
    const { kept } = flat({ tracks: walled(flatTrack(1, "loop", "lumber_pile", OUT), flatTrack(2, "loop", "wood_pile", [0.6, 0.4, 0.8, 0.5])) });
    expect(kept.map((k) => k.observation.concept).sort()).toEqual(["lumber_pile", "wood_pile"]);
  });
});

describe("observe does not place an object from beyond the wall's base", () => {
  const BEYOND: Box = [0.3, 0.05, 0.5, 0.2];

  it("drops a tree whose base sits above the wall's base, never calling it 0 feet away", () => {
    const { kept, dropped } = flat({ tracks: [wall(), flatTrack(1, "loop", "tree", BEYOND)] });
    expect(kept).toEqual([]);
    expect(dropped.find((d) => d.trackIds[0] === trackId(1))!.reason).toBe("seen only beyond the wall's base, so its distance is unknown");
  });

  it("keeps a tree whose mask touches the wall, whatever its box says", () => {
    const rows = (row: number) => Array.from({ length: 32 }, () => row);
    const every = (row: number) => Object.fromEntries(FRAMES.map((frame) => [frame, rows(row)]));
    const input = flatInput({ tracks: [wall(), flatTrack(1, "loop", "tree", BEYOND)], loopTilt: 30 });
    const { kept } = observe({ ...input, masks: { [trackId(99)]: every(0.2), [trackId(1)]: every(0.2) } });
    expect(kept.map((k) => k.observation.contact)).toEqual(["yes"]);
  });

  it("measures an object from its frames in front of the wall, leaving out those beyond it", () => {
    const track = framed(1, "shed", [[0, BEYOND], [1, BEYOND], [2, OUT], [3, OUT]]);
    const { kept } = flat({ tracks: [wall(), track] });
    expect(kept[0]!.observation.distanceFeet).toEqual(distanceAt(0.5));
  });

  it("keeps an object at the wall's base within the contact margin", () => {
    const { kept } = flat({ tracks: [wall(), flatTrack(1, "loop", "tree", [0.3, 0.2, 0.5, 0.35 - CONTACT_MARGIN])], loopTilt: 30 });
    expect(kept).toHaveLength(1);
  });

  it("keeps what sits on the house line there, and leaves anything else on the ground unplaced", () => {
    for (const concept of ["tree_branch_over_roof", "roof_debris", "foundation_vent"] as const) {
      expect(flat({ tracks: [wall(), flatTrack(1, "loop", concept, BEYOND)], loopTilt: 30 }).kept, concept).toHaveLength(1);
    }
    const pile = flat({ tracks: [wall(), flatTrack(1, "loop", "wood_pile", BEYOND)], loopTilt: 30 });
    expect(pile.kept).toEqual([]);
    expect(pile.dropped.map((d) => d.reason)).toEqual([expect.any(String), NOT_MEASURED]);
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

  it("measures the gap to a chimney on the branch's left, and counts one overlapping it as touching", () => {
    const flagsWith = (left: number, right: number) =>
      flat({ tracks: [wall(WALL), branch([0.6, 0.45, 0.8, 0.55]), chimney([left, 0.1, right, 0.3])] }).kept[0]!.observation.flags;
    expect(flagsWith(0.02, 0.1)).toEqual(["near_chimney"]);
    expect(flagsWith(0.02, 0.07)).toEqual([]);
    expect(flagsWith(0.7, 0.9)).toEqual(["near_chimney"]);
  });

  it("keeps the one inside frame as the proof when a more confident frame touches the edge", () => {
    const touching: Box = [0.3, 0.4, 0.5, 0.99];
    const { kept } = flat({ tracks: [wall(), framed(1, "shed", [[0, OUT, 0.6], [1, touching, 0.9]])] });
    expect(kept[0]!.proof).toMatchObject({ frame: 0, inside: true, confidence: 0.6 });
    expect(kept[0]!.notes).toEqual([]);
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

  it("drops an object whose tilt reads just past straight down", () => {
    const past = flat({ tracks: [wall(), flatTrack(1, "loop", "shed", OUT)], loopTilt: 90.5 });
    expect(past.kept).toEqual([]);
    expect(past.dropped).toContainEqual({ trackIds: [trackId(1)], reason: UNMEASURED });
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

  it("joins or keeps apart by the turn from facing each other, across the wrap at north and the south", () => {
    const tracks = [flatTrack(1, "loop", "shed", OUT), wall(), flatTrack(2, "pan", "shed", OUT)];
    const around = (degrees: number) => ((degrees % 360) + 360) % 360;
    for (const loopHeading of [0, 100, 180, 350]) {
      for (const off of [-31, -30, 0, 30, 31, 90, 180]) {
        const kept = flat({ tracks, panTilt: 60, loopHeading, panHeading: around(loopHeading + 180 + off) }).kept;
        expect(kept, `${loopHeading} ${off}`).toHaveLength(Math.abs(off) <= 30 ? 1 : 2);
      }
    }
  });

  it("joins a loop sighting seen inside the picture on one frame only, the other frame cut off by the edge", () => {
    const touching: Box = [0.3, 0.4, 0.5, 0.99];
    const tracks = [framed(1, "shed", [[0, OUT], [1, touching]]), wall(), flatTrack(2, "pan", "shed", OUT)];
    expect(flat({ tracks, panTilt: 60 }).kept).toHaveLength(1);
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

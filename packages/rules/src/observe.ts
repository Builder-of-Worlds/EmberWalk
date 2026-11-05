import type { z } from "zod";
import { Clip as ClipSchema, Tag as TagSchema, tagSide, Track as TrackSchema, type Clip, type Concept, type Contact, type Tag, type Track } from "@emberwalk/shared";
import { CAMERA_HEIGHT_FEET, depthFeet, feetFromWall, groundFeet, sampleNear, verticalFov, type FeetRange, type View } from "./ground.ts";
import { bandFor } from "./lookup.ts";
import { Observation } from "./evaluate.ts";
import type { Flag } from "./table.ts";

export const MIN_CONFIDENCE = 0.5;
export const MIN_FRAMES = 2;
export const EDGE_MARGIN = 0.02;
export const CONTACT_MARGIN = 0.06;
export const MERGE_HEADING_DEGREES = 30;
export const CHIMNEY_FEET = 10;
export const MAX_TRACKS = 16;
export const MASK_BANDS = 32;

type Box = [number, number, number, number];
type Frame = { frame: number; box: Box; confidence: number };
type Contacted = z.infer<typeof Contact>;
type Bands = (number | null)[];
type Masks = Record<string, Record<number, Bands>>;

export type Proof = { clipId: string; frame: number; box: Box; confidence: number; inside: boolean };
export type Kept = { observation: Observation; trackIds: string[]; proof: Proof; notes: string[] };
export type Dropped = { trackIds: string[]; reason: string };
export type Observed = { kept: Kept[]; dropped: Dropped[] };
export type ObserveInput = { clips: Clip[]; tracks: Track[]; tags: Tag[]; startByClip: Record<string, number>; masks?: Masks; longSideFovDegrees?: number };

type Candidate = {
  tracks: Track[];
  clip: Clip;
  distanceFeet: FeetRange;
  groundFeet: FeetRange;
  headingDegrees: number | null;
  contact: Contacted;
  flags: Flag[];
  notes: string[];
};

const NEVER: readonly Concept[] = ["house_wall"];
const ON_THE_HOUSE: readonly Concept[] = ["chimney", "wood_deck"];
const AT_HOUSE: FeetRange = { low: 0, high: 0 };
const ON_THE_ROOF_LINE: readonly Concept[] = ["roof_debris", "tree_branch_over_roof"];
const SHOWS_PAST_THE_HOUSE: readonly Concept[] = ["tree", "shed"];
const ON_THE_HOUSE_LINE: readonly Concept[] = ["tree_branch_over_roof", "roof_debris", "foundation_vent"];
const ONE_THING: readonly (readonly [keep: Concept, into: Concept])[] = [["lumber_pile", "wood_pile"]];
const SAME_BOX_SHARE = 0.5;
const PICK_UP_SECONDS = 3;
const PICK_UP_PICTURE = 0.25;
const OFTEN_SEVERAL_ON_A_SIDE: readonly Concept[] = ["tree", "shrub"];
const ONE_FIX_FOR_THE_SET: readonly Concept[] = ["patio_furniture", "trash_can", "dry_grass"];
const HOUSE_SHARE = 0.92;
const TOUCH_FEET = 5;
const DEEP_PILES: readonly Concept[] = ["wood_pile", "lumber_pile"];
const PILE_DEPTH_FEET = 3;
export const BEYOND_WALL = "seen only beyond the wall's base, so its distance is unknown";
export const NOT_MEASURED = "on the ground past the wall's base or with no wall behind it, so its distance is not measured";
export const HOUSE_AS_SHED = "a shed lying inside the house wall's box is part of the house";

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const medianRange = (ranges: FeetRange[]): FeetRange => ({ low: median(ranges.map((r) => r.low)), high: median(ranges.map((r) => r.high)) });

const area = ([x0, y0, x1, y1]: Box) => (x1 - x0) * (y1 - y0);

const isInside = ([x0, y0, x1, y1]: Box) => x0 > EDGE_MARGIN && y0 > EDGE_MARGIN && x1 < 1 - EDGE_MARGIN && y1 < 1 - EDGE_MARGIN;

const overlapShare = (a: Box, b: Box) => {
  const shared = Math.max(0, Math.min(a[2], b[2]) - Math.max(a[0], b[0])) * Math.max(0, Math.min(a[3], b[3]) - Math.max(a[1], b[1]));
  const either = area(a) + area(b) - shared;
  return either > 0 ? shared / either : 0;
};

export const picksUp = (left: Pick<Frame, "frame" | "box">, next: Pick<Frame, "frame" | "box">, fps: number): boolean => {
  const seconds = (next.frame - left.frame) / fps;
  const across = Math.hypot((left.box[0] + left.box[2] - next.box[0] - next.box[2]) / 2, (left.box[1] + left.box[3] - next.box[1] - next.box[3]) / 2);
  return seconds > 0 && seconds <= PICK_UP_SECONDS && across <= PICK_UP_PICTURE;
};

const sideways = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2];

const confident = (track: Track): Frame[] => track.frames.filter((f) => f.confidence >= MIN_CONFIDENCE) as Frame[];

const better = (a: Frame, b: Frame) => a.confidence > b.confidence || (a.confidence === b.confidence && area(a.box) > area(b.box));

const turn = (from: number, to: number) => Math.abs((((to - from) % 360) + 540) % 360 - 180);

const hull = (boxes: Box[]): Box | null =>
  boxes.length === 0
    ? null
    : [Math.min(...boxes.map(([x0]) => x0)), Math.min(...boxes.map(([, y0]) => y0)), Math.max(...boxes.map(([, , x1]) => x1)), Math.max(...boxes.map(([, , , y1]) => y1))];

const allBoxesOn = (tracks: Track[], concept: Concept): Map<number, Box[]> => {
  const byFrame = new Map<number, Box[]>();
  for (const track of tracks.filter((t) => t.concept === concept))
    for (const f of confident(track)) byFrame.set(f.frame, [...(byFrame.get(f.frame) ?? []), f.box as Box]);
  return byFrame;
};

const boxesOn = (tracks: Track[], concept: Concept): Map<number, Box> => new Map([...allBoxesOn(tracks, concept)].map(([frame, boxes]) => [frame, hull(boxes)!]));

const insideShare = (box: Box, wall: Box) => {
  const shared = Math.max(0, Math.min(box[2], wall[2]) - Math.max(box[0], wall[0])) * Math.max(0, Math.min(box[3], wall[3]) - Math.max(box[1], wall[1]));
  return area(box) > 0 ? shared / area(box) : 0;
};

// A wall lying inside the object's own box is the object read as a wall, never a wall behind it.
const isOwnWall = (box: Box, wall: Box) => insideShare(wall, box) >= HOUSE_SHARE;

const wallsBehind = (frames: Frame[], walls: Map<number, Box[]>): Map<number, Box> =>
  new Map(
    frames.flatMap((f) => {
      const behind = hull((walls.get(f.frame) ?? []).filter((wall) => sideways(f.box, wall) && !isOwnWall(f.box, wall)));
      return behind === null ? [] : [[f.frame, behind] as const];
    }),
  );

const liesInHouse = (frames: Frame[], walls: Map<number, Box[]>) => {
  const shares = frames.flatMap((f) => {
    const here = walls.get(f.frame);
    return here === undefined ? [] : [Math.max(...here.map((wall) => insideShare(f.box, wall)))];
  });
  return shares.length >= MIN_FRAMES && median(shares) >= HOUSE_SHARE;
};

export const contactOf = (concept: Concept, frames: Frame[], walls: Map<number, Box>): Contacted => {
  const seen = frames.flatMap((f) => {
    const wall = walls.get(f.frame);
    return wall !== undefined && sideways(f.box, wall) ? [{ box: f.box, wallY: wall[3] }] : [];
  });
  if (seen.length < MIN_FRAMES) return "not_checked";
  const touching = seen.filter(({ box, wallY }) => Math.abs(box[3] - wallY) <= CONTACT_MARGIN).length;
  if (touching >= MIN_FRAMES && touching * 2 >= seen.length) return "yes";
  if (seen.filter(({ box, wallY }) => box[1] < wallY && box[3] > wallY).length >= MIN_FRAMES)
    return concept === "wooden_fence" ? "yes" : "not_checked";
  return "no";
};

const checkMasks = (masks: Masks, ids: Set<string>) => {
  for (const [id, frames] of Object.entries(masks)) {
    if (!ids.has(id)) throw new Error(`masks for a track not given: ${id}`);
    for (const [frame, row] of Object.entries(frames)) {
      if (row.length !== MASK_BANDS) throw new Error(`the mask of track ${id} on frame ${frame} needs ${MASK_BANDS} bands`);
      if (row.some((v) => v !== null && !(v >= 0 && v <= 1))) throw new Error(`the mask of track ${id} on frame ${frame} has a row outside 0 to 1`);
    }
  }
};

const lower = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.max(a, b));

const wallMasksOn = (tracks: Track[], masks: Masks, own: Frame[]): Map<number, Bands> => {
  const byFrame = new Map<number, Bands>();
  const ownBox = new Map(own.map((f) => [f.frame, f.box]));
  for (const track of tracks.filter((t) => t.concept === "house_wall"))
    for (const [key, row] of Object.entries(masks[track.id] ?? {})) {
      const box = ownBox.get(Number(key));
      const wall = track.frames.find((f) => f.frame === Number(key))?.box;
      if (box !== undefined && wall !== undefined && isOwnWall(box, wall as Box)) continue;
      const held = byFrame.get(Number(key));
      byFrame.set(Number(key), held === undefined ? row : row.map((v, band) => lower(v, held[band] ?? null)));
    }
  return byFrame;
};

export const maskContactOf = (frames: Frame[], own: Record<number, Bands> | undefined, walls: Map<number, Bands>): Contacted | null => {
  const gaps = frames.flatMap((f) => {
    const mine = own?.[f.frame];
    const wall = walls.get(f.frame);
    if (mine === undefined || wall === undefined) return [];
    return [mine.flatMap((v, band) => (v === null || wall[band] == null ? [] : [Math.abs(v - wall[band]!)]))];
  });
  if (gaps.length < MIN_FRAMES) return null;
  const shared = gaps.filter((g) => g.length > 0);
  if (shared.filter((g) => g.some((gap) => gap <= CONTACT_MARGIN)).length >= MIN_FRAMES) return "yes";
  return shared.length >= MIN_FRAMES ? "no" : "not_checked";
};

export function observe(input: ObserveInput): Observed {
  const horizontalFov = (clip: Clip) => verticalFov({ width: clip.height, height: clip.width }, input.longSideFovDegrees);
  const clips = new Map(input.clips.map((c) => [c.id, ClipSchema.parse(c)]));
  const tracks = input.tracks.map((t) => TrackSchema.parse(t));
  const tags = input.tags.map((t) => TagSchema.parse(t));
  if (new Set(tracks.map((t) => t.id)).size !== tracks.length) throw new Error("every track needs its own id");
  const masks = input.masks ?? {};
  checkMasks(masks, new Set(tracks.map((t) => t.id)));
  for (const track of tracks) {
    if (!clips.has(track.clipId)) throw new Error(`track ${track.id} comes from a clip not given: ${track.clipId}`);
    if (!(input.startByClip[track.clipId]! >= 0)) throw new Error(`clip ${track.clipId} has no start in the walk`);
  }
  const samples = tags.flatMap((t) => t.samples).sort((a, b) => a.t - b.t);
  const timeOf = (clip: Clip, frame: number) => input.startByClip[clip.id]! + frame / clip.fps;
  const viewAtTime = (clip: Clip, t: number): View | null => {
    const sample = sampleNear(samples, t);
    if (sample === null || !(Math.abs(sample.tiltDegrees) <= 90)) return null;
    return { tiltBelowHorizonDegrees: sample.tiltDegrees, verticalFovDegrees: verticalFov(clip, input.longSideFovDegrees), cameraHeightFeet: CAMERA_HEIGHT_FEET };
  };
  const viewAt = (clip: Clip, frame: number) => viewAtTime(clip, timeOf(clip, frame));
  const inClip = (clip: Clip) => tracks.filter((t) => t.clipId === clip.id);
  const loopWallFeet = [...clips.values()]
    .filter((c) => c.kind === "loop")
    .flatMap((clip) =>
      [...boxesOn(inClip(clip), "house_wall")].flatMap(([frame, wall]) => {
        const view = viewAt(clip, frame);
        const ground = view === null ? null : groundFeet({ y: wall[3], ...view });
        return ground === null ? [] : [ground];
      }),
    );
  const homeFeet = loopWallFeet.length === 0 ? null : medianRange(loopWallFeet);
  const line = tags.find((t) => t.kind === "pan" && t.propertyLine !== null)?.propertyLine ?? null;
  const panClip = [...clips.values()].find((c) => c.kind === "pan");
  const lineView = line === null || panClip === undefined ? null : viewAtTime(panClip, line.t);
  const lineFeet = line === null || lineView === null ? null : groundFeet({ y: line.at.y, ...lineView });

  const dropped: Dropped[] = [];
  const candidates: Candidate[] = [];
  for (const track of tracks) {
    const drop = (reason: string) => dropped.push({ trackIds: [track.id], reason });
    if (NEVER.includes(track.concept)) {
      drop(`a ${track.concept} places other objects and is never a finding`);
      continue;
    }
    const sure = confident(track);
    if (sure.length < MIN_FRAMES) {
      drop(`seen on fewer than ${MIN_FRAMES} frames at confidence ${MIN_CONFIDENCE} or more`);
      continue;
    }
    const clip = clips.get(track.clipId)!;
    const notes: string[] = [];
    let frames = sure.filter((f) => isInside(f.box));
    if (frames.length === 0) {
      frames = sure;
      notes.push("placed on frames cut off by the picture's edge");
    }
    const wallBoxes = allBoxesOn(inClip(clip), "house_wall");
    const chimneyBoxes = allBoxesOn(inClip(clip), "chimney");
    if (track.concept === "shed" && liesInHouse(sure, wallBoxes)) {
      drop(HOUSE_AS_SHED);
      continue;
    }
    const walls = wallsBehind(sure, wallBoxes);
    const onHouse = ON_THE_HOUSE.includes(track.concept);
    const contact = onHouse
      ? "not_checked"
      : (maskContactOf(frames, masks[track.id], wallMasksOn(inClip(clip), masks, frames)) ?? contactOf(track.concept, frames, walls));
    const beyondWall = (f: Frame) => {
      if (clip.kind !== "loop" || contact === "yes" || !SHOWS_PAST_THE_HOUSE.includes(track.concept)) return false;
      const wall = walls.get(f.frame);
      return wall !== undefined && f.box[3] < wall[3] - CONTACT_MARGIN;
    };
    if (!onHouse && frames.every(beyondWall)) {
      drop(BEYOND_WALL);
      continue;
    }
    let unplaced = 0;
    const placeFrames = () =>
      frames.filter((f) => !beyondWall(f)).flatMap((f) => {
        const view = viewAt(clip, f.frame);
        if (view === null) return [];
        const ground = groundFeet({ y: f.box[3], ...view });
        if (ground === null) return [];
        const footUnseen = f.box[3] >= 1 - EDGE_MARGIN;
        if (clip.kind === "pan") {
          if (homeFeet === null) return [];
          const out = feetFromWall({ kind: "pan", y: f.box[3], homeFeet }, view)!;
          return [{ ground, wall: footUnseen ? { low: 0, high: out.high } : out }];
        }
        const wall = walls.get(f.frame);
        const fromWall = wall === undefined ? null : feetFromWall({ kind: "loop", y: f.box[3], wallY: wall[3] }, view);
        if (fromWall === null && SHOWS_PAST_THE_HOUSE.includes(track.concept)) return [];
        // Seen past the wall's base or with no wall behind it, its distance is never guessed: it stays unplaced unless its foot is below the picture.
        const pastBase = wall === undefined || f.box[3] < wall[3] - CONTACT_MARGIN;
        if ((fromWall === null || fromWall.high === 0) && pastBase && !footUnseen && contact !== "yes" && homeFeet !== null && !ON_THE_HOUSE_LINE.includes(track.concept)) {
          unplaced += 1;
          return [];
        }
        // On the wall's base, or with its foot below the picture, it stands somewhere between the wall and the camera.
        if ((fromWall === null || fromWall.high === 0) && homeFeet !== null) return [{ ground, wall: { low: 0, high: homeFeet.high } }];
        if (fromWall === null) return [];
        // A foot below the picture stands somewhere between that picture edge and the camera, so the far end is the camera, at the wall's own depth.
        const toCamera = footUnseen ? groundFeet({ y: wall![3], ...view }) : null;
        return [{ ground, wall: toCamera === null ? fromWall : { low: fromWall.low, high: Math.max(fromWall.high, toCamera.high) } }];
      });
    const measuredPlaces = onHouse ? [] : placeFrames();
    // Seen only wholly above the horizon and over the house's own walls or chimney, it lies on the roof line itself.
    // A tree behind the house is cut off at the roofline, so a branch counts only where its box reaches down into the house's own box.
    const roofLine = (): "house" | "behind" | null => {
      if (clip.kind !== "loop" || !ON_THE_ROOF_LINE.includes(track.concept)) return null;
      const viewed = frames.flatMap((f) => {
        const view = viewAt(clip, f.frame);
        return view === null ? [] : [{ f, aboveHorizon: depthFeet(f.box[3], view) === null }];
      });
      if (!viewed.every((v) => v.aboveHorizon)) return null;
      const house = (frame: number) => [...(wallBoxes.get(frame) ?? []), ...(chimneyBoxes.get(frame) ?? [])];
      const over = viewed.filter(({ f }) => house(f.frame).some((h) => sideways(f.box, h)));
      if (over.length < MIN_FRAMES) return null;
      if (track.concept !== "tree_branch_over_roof") return "house";
      const into = over.filter(({ f }) => house(f.frame).some((h) => sideways(f.box, h) && f.box[3] > h[1] + CONTACT_MARGIN));
      return into.length >= MIN_FRAMES ? "house" : "behind";
    };
    const onRoof = measuredPlaces.length === 0 ? roofLine() : null;
    if (onRoof === "behind") {
      drop(NOT_MEASURED);
      continue;
    }
    const atHouse = onHouse || onRoof === "house";
    const placed = atHouse ? [{ ground: AT_HOUSE, wall: AT_HOUSE }] : measuredPlaces;
    if (placed.length === 0) {
      if (unplaced > 0) {
        drop(NOT_MEASURED);
        continue;
      }
      drop(clip.kind === "pan" && homeFeet === null ? "no wall in the loop, so a pan object cannot be placed" : "no wall, no tilt or only the horizon on its frames, so its distance is unknown");
      continue;
    }
    const ground = medianRange(placed.map((p) => p.ground));
    const measured = medianRange(placed.map((p) => p.wall));
    const touchDoubted = contact === "yes" && track.concept !== "wooden_fence" && !onHouse && measured.low > TOUCH_FEET;
    // A pile has depth: its foot shows a little in front of the wall it leans on while its stack rises past the wall's base.
    const risesPastBase = frames.filter((f) => {
      const wall = walls.get(f.frame);
      return wall !== undefined && sideways(f.box, wall) && f.box[1] < wall[3] && f.box[3] > wall[3];
    }).length;
    const pileAgainst = contact === "not_checked" && DEEP_PILES.includes(track.concept) && clip.kind === "loop" && risesPastBase >= MIN_FRAMES && measured.low <= PILE_DEPTH_FEET;
    const heldContact: Contacted = touchDoubted ? "not_checked" : pileAgainst ? "yes" : contact;
    const distanceFeet = heldContact === "yes" ? { low: 0, high: measured.high } : measured;
    if (bandFor(distanceFeet) === null) {
      drop("more than 100 feet from the house");
      continue;
    }
    if (clip.kind === "pan") {
      if (line === null) notes.push("no property line was tapped, so everything in the pan is kept");
      else if (lineFeet !== null && ground.low > lineFeet.high) {
        drop("past the property line");
        continue;
      }
    }
    const headings = frames.flatMap((f) => sampleNear(samples, timeOf(clip, f.frame))?.headingDegrees ?? []);
    const flags: Flag[] = [];
    if (track.concept === "tree_branch_over_roof") {
      const chimneys = boxesOn(inClip(clip), "chimney");
      const feetWide = (frame: number) => {
        const view = viewAt(clip, frame);
        const wall = boxesOn(inClip(clip), "house_wall").get(frame);
        const depth = view === null || wall === undefined ? null : groundFeet({ y: wall[3], ...view });
        return depth === null ? null : 2 * depth.low * Math.tan((horizontalFov(clip) * Math.PI) / 360);
      };
      const near = sure.filter((f) => {
        const chimney = chimneys.get(f.frame);
        const wide = chimney === undefined ? null : feetWide(f.frame);
        if (chimney === undefined || wide === null) return false;
        const gap = Math.max(0, chimney[0] - f.box[2], f.box[0] - chimney[2]);
        return gap * wide <= CHIMNEY_FEET;
      });
      if (near.length >= MIN_FRAMES) flags.push("near_chimney");
    }
    candidates.push({ tracks: [track], clip, distanceFeet, groundFeet: ground, headingDegrees: headings.length === 0 ? null : median(headings), contact: heldContact, flags, notes });
  }

  const sameBox = (a: Candidate, b: Candidate) => {
    const own = new Map(a.tracks.flatMap((t) => confident(t).map((f) => [f.frame, f.box as Box] as const)));
    const shared = b.tracks.flatMap((t) => confident(t).flatMap((f) => (own.has(f.frame) ? [overlapShare(own.get(f.frame)!, f.box as Box)] : [])));
    return shared.length >= MIN_FRAMES && median(shared) >= SAME_BOX_SHARE;
  };
  for (const [from, into] of ONE_THING)
    for (const lesser of candidates.filter((c) => c.tracks[0]!.concept === from)) {
      const kept = candidates.find((c) => c.tracks[0]!.concept === into && c.clip === lesser.clip && sameBox(c, lesser));
      if (kept === undefined) continue;
      if (kept.tracks.length + lesser.tracks.length > MAX_TRACKS) continue;
      kept.tracks.push(...lesser.tracks);
      kept.distanceFeet = { low: Math.min(kept.distanceFeet.low, lesser.distanceFeet.low), high: Math.max(kept.distanceFeet.high, lesser.distanceFeet.high) };
      kept.groundFeet = { low: Math.min(kept.groundFeet.low, lesser.groundFeet.low), high: Math.max(kept.groundFeet.high, lesser.groundFeet.high) };
      kept.contact = kept.contact === "yes" || lesser.contact === "yes" ? "yes" : kept.contact === "not_checked" || lesser.contact === "not_checked" ? "not_checked" : "no";
      kept.flags = [...new Set([...kept.flags, ...lesser.flags])];
      kept.notes = [...new Set([...kept.notes, ...lesser.notes])];
      candidates.splice(candidates.indexOf(lesser), 1);
    }

  const groups = candidates.map((c) => [c]);
  const framesOf = (group: Candidate[]) => new Set(group.flatMap((c) => c.tracks.flatMap((t) => confident(t).map((f) => f.frame))));
  const ends = (c: Candidate) => {
    const frames = c.tracks.flatMap((t) => confident(t)).sort((p, q) => p.frame - q.frame);
    return { first: frames[0]!, last: frames.at(-1)! };
  };
  const continues = (x: Candidate, y: Candidate) => {
    const [a, b] = [ends(x), ends(y)];
    return picksUp(a.last, b.first, x.clip.fps) || picksUp(b.last, a.first, x.clip.fps);
  };
  const sideOf = (c: Candidate) => {
    const t = input.startByClip[c.clip.id]! + median(c.tracks.flatMap((track) => confident(track).map((f) => f.frame))) / c.clip.fps;
    const tag = tags.find((g) => g.kind === c.clip.kind && t >= g.startSeconds && t <= g.endSeconds);
    return tag === undefined ? null : tagSide(tag);
  };
  const facesSame = (x: Candidate, y: Candidate) => x.headingDegrees !== null && y.headingDegrees !== null && turn(x.headingDegrees, y.headingDegrees) <= MERGE_HEADING_DEGREES;
  const onSameSide = (x: Candidate, y: Candidate) => {
    if (bandFor(x.distanceFeet) !== bandFor(y.distanceFeet)) return false;
    const side = sideOf(x);
    return side !== null && side === sideOf(y) && !OFTEN_SEVERAL_ON_A_SIDE.includes(x.tracks[0]!.concept);
  };
  const repeats = (a: Candidate[], b: Candidate[]) => {
    const seen = framesOf(a);
    const concept = a[0]!.tracks[0]!.concept;
    return (
      a[0]!.clip === b[0]!.clip &&
      concept === b[0]!.tracks[0]!.concept &&
      [...a, ...b].flatMap((c) => c.tracks).length <= MAX_TRACKS &&
      (ONE_FIX_FOR_THE_SET.includes(concept) ? a.some((x) => b.some((y) => onSameSide(x, y))) : ![...framesOf(b)].some((frame) => seen.has(frame))) &&
      a.some((x) =>
        b.some(
          (y) =>
            ((continues(x, y) && facesSame(x, y)) || onSameSide(x, y)) &&
            x.distanceFeet.low <= y.distanceFeet.high &&
            y.distanceFeet.low <= x.distanceFeet.high,
        ),
      )
    );
  };
  for (let i = 0; i < groups.length; i += 1)
    for (let j = groups.length - 1; j > i; j -= 1)
      if (repeats(groups[i]!, groups[j]!)) groups[i]!.push(...groups.splice(j, 1)[0]!);

  const joins = (loop: Candidate, pan: Candidate) =>
    loop.tracks[0]!.concept === pan.tracks[0]!.concept &&
    loop.distanceFeet.low <= pan.distanceFeet.high &&
    pan.distanceFeet.low <= loop.distanceFeet.high &&
    loop.headingDegrees !== null &&
    pan.headingDegrees !== null &&
    turn(180 + loop.headingDegrees, pan.headingDegrees) <= MERGE_HEADING_DEGREES;
  for (const pan of candidates.filter((c) => c.clip.kind === "pan"))
    for (const loop of candidates.filter((c) => c.clip.kind === "loop")) {
      if (!joins(loop, pan)) continue;
      const a = groups.find((g) => g.includes(pan))!;
      const b = groups.find((g) => g.includes(loop))!;
      if (a === b) continue;
      a.push(...b);
      groups.splice(groups.indexOf(b), 1);
    }

  // One mowing fixes dry grass, so it is one finding per band around the whole house; a band never joins another.
  const grass = groups.filter((g) => g[0]!.tracks[0]!.concept === "dry_grass");
  const byBand = new Map<string | null, Candidate[][]>();
  for (const candidate of grass.flat()) {
    const held = byBand.get(bandFor(candidate.distanceFeet)) ?? [[]];
    const last = held.at(-1)!;
    if (last.flatMap((c) => c.tracks).length + candidate.tracks.length > MAX_TRACKS) held.push([candidate]);
    else last.push(candidate);
    byBand.set(bandFor(candidate.distanceFeet), held);
  }
  groups.splice(0, groups.length, ...groups.filter((g) => !grass.includes(g)), ...[...byBand.values()].flat());

  const kept = groups.map((group): Kept => {
    const trackIds = group.flatMap((c) => c.tracks.map((t) => t.id));
    if (trackIds.length > MAX_TRACKS) throw new Error(`an observation holds at most ${MAX_TRACKS} tracks: ${trackIds.length}`);
    const contacts = group.map((c) => c.contact);
    const contact: Contacted = contacts.includes("yes") ? "yes" : contacts.includes("not_checked") ? "not_checked" : "no";
    const notes = [...new Set(group.flatMap((c) => c.notes))];
    const frames = group.flatMap((c) => c.tracks.flatMap((t) => confident(t).map((f) => ({ ...f, clipId: t.clipId }))));
    const pick = (list: typeof frames) => list.reduce((best, f) => (better(f, best) ? f : best));
    const insideFrames = frames.filter((f) => isInside(f.box));
    const best = pick(insideFrames.length > 0 ? insideFrames : frames);
    if (insideFrames.length === 0) notes.push("the proof frame touches the picture's edge");
    const observation = Observation.parse({
      id: trackIds[0]!,
      concept: group[0]!.tracks[0]!.concept,
      distanceFeet: {
        low: Math.min(...group.map((c) => c.distanceFeet.low)),
        high: Math.max(...group.map((c) => c.distanceFeet.high)),
      },
      contact,
      plantState: null,
      spacing: null,
      flags: [...new Set(group.flatMap((c) => c.flags))],
      frameShare: area(best.box),
      confidence: best.confidence,
    });
    return { observation, trackIds, proof: { clipId: best.clipId, frame: best.frame, box: best.box, confidence: best.confidence, inside: insideFrames.length > 0 }, notes };
  });
  return { kept, dropped };
}

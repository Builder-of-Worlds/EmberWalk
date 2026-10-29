import type { z } from "zod";
import { Clip as ClipSchema, Tag as TagSchema, Track as TrackSchema, type Clip, type Concept, type Contact, type Tag, type Track } from "@emberwalk/shared";
import { CAMERA_HEIGHT_FEET, feetFromWall, groundFeet, sampleNear, verticalFov, type FeetRange, type View } from "./ground.ts";
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

type Box = [number, number, number, number];
type Frame = { frame: number; box: Box; confidence: number };
type Contacted = z.infer<typeof Contact>;

export type Proof = { clipId: string; frame: number; box: Box; confidence: number; inside: boolean };
export type Kept = { observation: Observation; trackIds: string[]; proof: Proof; notes: string[] };
export type Dropped = { trackIds: string[]; reason: string };
export type Observed = { kept: Kept[]; dropped: Dropped[] };
export type ObserveInput = { clips: Clip[]; tracks: Track[]; tags: Tag[]; startByClip: Record<string, number> };

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

const NEVER: readonly Concept[] = ["house_wall", "chimney"];

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
};

const medianRange = (ranges: FeetRange[]): FeetRange => ({ low: median(ranges.map((r) => r.low)), high: median(ranges.map((r) => r.high)) });

const area = ([x0, y0, x1, y1]: Box) => (x1 - x0) * (y1 - y0);

const isInside = ([x0, y0, x1, y1]: Box) => x0 > EDGE_MARGIN && y0 > EDGE_MARGIN && x1 < 1 - EDGE_MARGIN && y1 < 1 - EDGE_MARGIN;

const sideways = (a: Box, b: Box) => a[0] < b[2] && b[0] < a[2];

const confident = (track: Track): Frame[] => track.frames.filter((f) => f.confidence >= MIN_CONFIDENCE) as Frame[];

const better = (a: Frame, b: Frame) => a.confidence > b.confidence || (a.confidence === b.confidence && area(a.box) > area(b.box));

const turn = (from: number, to: number) => Math.abs((((to - from) % 360) + 540) % 360 - 180);

const hull = (boxes: Box[]): Box | null =>
  boxes.length === 0
    ? null
    : [Math.min(...boxes.map((b) => b[0])), Math.min(...boxes.map((b) => b[1])), Math.max(...boxes.map((b) => b[2])), Math.max(...boxes.map((b) => b[3]))];

const boxesOn = (tracks: Track[], concept: Concept): Map<number, Box> => {
  const byFrame = new Map<number, Box[]>();
  for (const track of tracks.filter((t) => t.concept === concept))
    for (const f of confident(track)) byFrame.set(f.frame, [...(byFrame.get(f.frame) ?? []), f.box as Box]);
  return new Map([...byFrame].map(([frame, boxes]) => [frame, hull(boxes)!]));
};

export const contactOf = (concept: Concept, frames: Frame[], walls: Map<number, Box>): Contacted => {
  const seen = frames.flatMap((f) => {
    const wall = walls.get(f.frame);
    return wall !== undefined && sideways(f.box, wall) ? [{ box: f.box, wallY: wall[3] }] : [];
  });
  if (seen.length < MIN_FRAMES) return "not_checked";
  if (seen.filter(({ box, wallY }) => Math.abs(box[3] - wallY) <= CONTACT_MARGIN).length >= MIN_FRAMES) return "yes";
  if (seen.filter(({ box, wallY }) => box[1] < wallY && box[3] > wallY).length >= MIN_FRAMES)
    return concept === "wooden_fence" ? "yes" : "not_checked";
  return "no";
};

const horizontalFov = (clip: Clip) => verticalFov({ width: clip.height, height: clip.width });

export function observe(input: ObserveInput): Observed {
  const clips = new Map(input.clips.map((c) => [c.id, ClipSchema.parse(c)]));
  const tracks = input.tracks.map((t) => TrackSchema.parse(t));
  const tags = input.tags.map((t) => TagSchema.parse(t));
  if (new Set(tracks.map((t) => t.id)).size !== tracks.length) throw new Error("every track needs its own id");
  for (const track of tracks) {
    if (!clips.has(track.clipId)) throw new Error(`track ${track.id} comes from a clip not given: ${track.clipId}`);
    if (!(input.startByClip[track.clipId]! >= 0)) throw new Error(`clip ${track.clipId} has no start in the walk`);
  }
  const samples = tags.flatMap((t) => t.samples).sort((a, b) => a.t - b.t);
  const timeOf = (clip: Clip, frame: number) => input.startByClip[clip.id]! + frame / clip.fps;
  const viewAtTime = (clip: Clip, t: number): View | null => {
    const sample = sampleNear(samples, t);
    if (sample === null || !(Math.abs(sample.tiltDegrees) <= 90)) return null;
    return { tiltBelowHorizonDegrees: sample.tiltDegrees, verticalFovDegrees: verticalFov(clip), cameraHeightFeet: CAMERA_HEIGHT_FEET };
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
    const walls = boxesOn(inClip(clip), "house_wall");
    const contact = contactOf(track.concept, frames, walls);
    const placed = frames.flatMap((f) => {
      const view = viewAt(clip, f.frame);
      if (view === null) return [];
      const ground = groundFeet({ y: f.box[3], ...view });
      if (ground === null) return [];
      if (clip.kind === "pan") return homeFeet === null ? [] : [{ ground, wall: feetFromWall({ kind: "pan", y: f.box[3], homeFeet }, view)! }];
      const wall = walls.get(f.frame);
      const fromWall = wall === undefined ? null : feetFromWall({ kind: "loop", y: f.box[3], wallY: wall[3] }, view);
      return fromWall === null ? [] : [{ ground, wall: fromWall }];
    });
    if (placed.length === 0) {
      drop(clip.kind === "pan" && homeFeet === null ? "no wall in the loop, so a pan object cannot be placed" : "no wall, no tilt or only the horizon on its frames, so its distance is unknown");
      continue;
    }
    const ground = medianRange(placed.map((p) => p.ground));
    const measured = medianRange(placed.map((p) => p.wall));
    const distanceFeet = contact === "yes" ? { low: 0, high: measured.high } : measured;
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
        const wall = walls.get(frame);
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
    candidates.push({ tracks: [track], clip, distanceFeet, groundFeet: ground, headingDegrees: headings.length === 0 ? null : median(headings), contact, flags, notes });
  }

  const groups = candidates.map((c) => [c]);
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

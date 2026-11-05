import { type MotionSample, type Side, Side as SideName, type Tag, tagSide } from "@emberwalk/shared";

export type RoutePart = { kind: "loop" | "walk" | "pan" | "sweep"; start_s?: number; end_s?: number; start_frame?: number; end_frame?: number; side?: string };
export type RouteParts = { fps?: number; parts: RoutePart[] };
type TimedPart = RoutePart & { start_s: number; end_s: number };
export type RouteLens = { focal_mm: number; sensor_width_mm: number };
export type RouteMotion = { camera?: RouteLens; samples: { t: number; pos_in: number[]; tilt_deg: number; heading_deg: number; shift_y?: number }[] };

const SHORTEST_SIDE_SECONDS = 1;

export type Wall = { side: string; start_in: number[] };

const toSegment = ([px = 0, py = 0]: number[], [ax = 0, ay = 0]: number[], [bx = 0, by = 0]: number[]): number => {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const along = length === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / length));
  return Math.hypot(px - ax - along * dx, py - ay - along * dy);
};

// Across a corner's diagonal two walls are equally near, so the side held changes only once another wall is nearer by this much.
const HOLD_IN = 24;

// The side is the nearest wall of the house's own footprint; a wall that is not one of the four plain sides, such as a garage or a wing, is front, which scoring leaves open.
export const sideOfCamera = (position: number[], footprint: Wall[], held?: Side): Side => {
  if (footprint.length < 3) throw new Error("a footprint needs at least three walls");
  const near = new Map<Side, number>();
  footprint.forEach((w, i) => {
    const named = SideName.safeParse(w.side);
    const side = named.success ? named.data : "front";
    const d = toSegment(position, w.start_in, footprint[(i + 1) % footprint.length]!.start_in);
    near.set(side, Math.min(near.get(side) ?? Infinity, d));
  });
  const [nearest, d] = [...near].reduce((best, entry) => (entry[1] < best[1] ? entry : best));
  return held !== undefined && held !== nearest && (near.get(held) ?? Infinity) - d <= HOLD_IN ? held : nearest;
};

const FOOTAGE_MATCH_SECONDS = 0.5;

// A shifted lens looks below the horizon with the camera level; a phone reports that view as tilt.
const shiftTilt = (shift: number, lens: RouteLens): number => (Math.atan((-shift * lens.sensor_width_mm) / lens.focal_mm) * 180) / Math.PI;

const toSample = (motion: RouteMotion) => (s: RouteMotion["samples"][number]): MotionSample => ({
  t: s.t,
  tiltDegrees: s.tilt_deg + (s.shift_y === undefined || motion.camera === undefined ? 0 : shiftTilt(s.shift_y, motion.camera)),
  headingDegrees: s.heading_deg,
});

export const footageFits = (route: { duration_s: number }, seconds: number): boolean => Math.abs(route.duration_s - seconds) <= FOOTAGE_MATCH_SECONDS;

const bare = (walkId: string, id: string, kind: Tag["kind"], side: Side, start: number, end: number, samples: MotionSample[]): Tag => ({
  id,
  walkId,
  kind,
  startSeconds: start,
  endSeconds: end,
  label: side,
  samples,
  propertyLine: null,
});

const loopTags = (walkId: string, part: TimedPart, motion: RouteMotion, footprint: Wall[], newId: () => string): Tag[] => {
  const within = motion.samples.filter((s) => s.t >= part.start_s && s.t <= part.end_s);
  const runs: { side: Side; from: number; samples: typeof within }[] = [];
  for (const sample of within) {
    const last = runs.at(-1);
    const side = sideOfCamera(sample.pos_in, footprint, last?.side);
    if (last?.side === side) last.samples.push(sample);
    else if (last !== undefined && sample.t - last.from < SHORTEST_SIDE_SECONDS) {
      last.side = side;
      last.samples.push(sample);
    } else runs.push({ side, from: sample.t, samples: [sample] });
  }
  return runs.map((run, i) =>
    bare(walkId, newId(), "loop", run.side, i === 0 ? part.start_s : run.from, runs[i + 1]?.from ?? part.end_s, run.samples.map(toSample(motion))),
  );
};

// Each pan carries the walking before it, because the pipeline clips from the first pan to the last.
const panTags = (walkId: string, pans: TimedPart[], motion: RouteMotion, newId: () => string): Tag[] =>
  pans.map((pan, i) => {
    const from = i === 0 ? pan.start_s : pans[i - 1]!.end_s;
    const samples = motion.samples.filter((s) => s.t >= from && s.t <= pan.end_s).map(toSample(motion));
    return bare(walkId, newId(), "pan", SideName.parse(pan.side), pan.start_s, pan.end_s, samples);
  });

// Frame 1 starts at 0 s and frame n ends at n / fps, as the render writes seconds when it gives them.
const timed = (route: RouteParts): TimedPart[] =>
  route.parts.map((p) => {
    if (p.start_s !== undefined && p.end_s !== undefined) return { ...p, start_s: p.start_s, end_s: p.end_s };
    if (p.start_frame === undefined || p.end_frame === undefined || route.fps === undefined) throw new Error(`a ${p.kind} part has neither seconds nor frames with an fps`);
    return { ...p, start_s: (p.start_frame - 1) / route.fps, end_s: p.end_frame / route.fps };
  });

// A lap with no loop of its own walks its loop between the pans.
export const routeTags = (walkId: string, route: RouteParts, motion: RouteMotion, footprint: Wall[], newId: () => string): Tag[] => {
  const parts = timed(route);
  const loopKind = parts.some((p) => p.kind === "loop") ? "loop" : "walk";
  return [
    ...parts.filter((p) => p.kind === loopKind).flatMap((p) => loopTags(walkId, p, motion, footprint, newId)),
    ...panTags(walkId, parts.filter((p) => p.kind === "pan"), motion, newId),
  ];
};

export const walkExitCode = (outcome: { status: string; missing?: string[] }): number => (outcome.status === "done" && (outcome.missing ?? []).length === 0 ? 0 : 1);

export const scoringSide = (tags: Tag[], seconds: number): Side | null => {
  const side = tags.map((t) => (seconds >= t.startSeconds && seconds <= t.endSeconds ? tagSide(t) : null)).find((s) => s !== null) ?? null;
  return side === "front" ? null : side;
};

// The tag says where the camera stood, so an object seen from two sides of a corner cannot claim either.
export const scoringSideOver = (tags: Tag[], seconds: number[]): Side | null => {
  const sides = new Set(seconds.map((t) => scoringSide(tags, t)));
  return sides.size === 1 ? [...sides][0]! : null;
};

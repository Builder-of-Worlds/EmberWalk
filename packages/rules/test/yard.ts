import { readFileSync } from "node:fs";
import type { Band, Clip, Concept, MotionSample, Tag, Track } from "@emberwalk/shared";

const json = (name: string) => JSON.parse(readFileSync(new URL(`../../../fixtures/synthetic/test-yard-2/${name}`, import.meta.url), "utf8"));

type Sample = { frame: number; t: number; pos_in: [number, number, number]; heading_deg: number; tilt_deg: number };
type FrameBox = { frame: number; t: number; box_px: [number, number, number, number] };
type Hazard = { id: string; concept: string; band: string; contact: boolean; box_in: { min: number[]; max: number[] }; frame_boxes: FrameBox[] };

const motion = json("motion.json") as { fps: number; camera: { width_px: number; height_px: number; vfov_deg: number }; samples: Sample[] };
const truth = json("truth.json") as { hazards: Hazard[] };

export const CAMERA = { width: motion.camera.width_px, height: motion.camera.height_px, vfovDegrees: motion.camera.vfov_deg };
export const CAMERA_HEIGHT_IN = 54;
export const EDGE_MARGIN = 0.02;

const BANDS: Record<string, Band> = { "0_5": "zone_0", "5_30": "zone_1", "30_100": "zone_2" };

export const HAZARDS = truth.hazards.map((h) => ({
  ...h,
  concept: h.concept.replace(/ /g, "_") as Concept,
  truthBand: BANDS[h.band]!,
}));
export type YardHazard = (typeof HAZARDS)[number];

const byFrame = new Map(motion.samples.map((s) => [s.frame, s]));
export const sampleAt = (frame: number): Sample => byFrame.get(frame)!;

export const MOTION: MotionSample[] = motion.samples.map((s) => ({ t: s.t, tiltDegrees: s.tilt_deg, headingDegrees: s.heading_deg % 360 }));

export const unit = ([x0, y0, x1, y1]: FrameBox["box_px"]): [number, number, number, number] => [
  x0 / CAMERA.width,
  y0 / CAMERA.height,
  x1 / CAMERA.width,
  y1 / CAMERA.height,
];

export const inside = ([x0, y0, x1, y1]: [number, number, number, number], margin = EDGE_MARGIN) =>
  x0 > margin && y0 > margin && x1 < 1 - margin && y1 < 1 - margin;

export const spreadFrames = (hazard: YardHazard, count = 5): FrameBox[] => {
  const kept = hazard.frame_boxes.filter((f) => inside(unit(f.box_px)));
  return Array.from({ length: count }, (_, i) => kept[Math.floor((i * (kept.length - 1)) / (count - 1))]!);
};

export const cameraToHazardFeet = (hazard: YardHazard, frame: number) => (sampleAt(frame).pos_in[1] - hazard.box_in.max[1]!) / 12;

export const wallRow = (frame: number): number => {
  const s = sampleAt(frame);
  const below = Math.atan(CAMERA_HEIGHT_IN / s.pos_in[1]) - (s.tilt_deg * Math.PI) / 180;
  return 0.5 + Math.tan(below) / (2 * Math.tan((CAMERA.vfovDegrees * Math.PI) / 360));
};

export const WALK_ID = "00000000-0000-4000-8000-000000000000";
export const LOOP_CLIP: Clip = {
  id: "00000000-0000-4000-8000-0000000000c1",
  walkId: WALK_ID,
  kind: "loop",
  file: "clips/test-yard-2/loop.mp4",
  fps: motion.fps,
  frameCount: motion.samples.length,
  width: CAMERA.width,
  height: CAMERA.height,
};
export const LOOP_TAG: Tag = {
  id: "00000000-0000-4000-8000-0000000000a1",
  walkId: WALK_ID,
  kind: "loop",
  startSeconds: 0,
  endSeconds: motion.samples.at(-1)!.t + 1 / motion.fps,
  label: "Loop",
  samples: MOTION,
  propertyLine: null,
};

const clamp = (v: number) => Math.max(0, Math.min(1, v));
const box = (b: [number, number, number, number]): [number, number, number, number] => b.map(clamp) as [number, number, number, number];
const positive = ([x0, y0, x1, y1]: [number, number, number, number]) => x0 < x1 && y0 < y1;

export const trackId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

export const hazardTrack = (hazard: YardHazard, n: number, confidence = 0.9): Track => ({
  id: trackId(n),
  clipId: LOOP_CLIP.id,
  concept: hazard.concept,
  samObjectId: n,
  frames: hazard.frame_boxes
    .map((f) => ({ frame: f.frame - 1, box: box(unit(f.box_px)), mask: null, confidence }))
    .filter((f) => positive(f.box)),
});

export const wallTrack = (n: number, frames = motion.samples.map((s) => s.frame)): Track => ({
  id: trackId(n),
  clipId: LOOP_CLIP.id,
  concept: "house_wall",
  samObjectId: n,
  frames: frames.map((frame) => ({ frame: frame - 1, box: box([0, wallRow(frame) - 0.2, 1, wallRow(frame)]), mask: null, confidence: 0.95 })),
});

export const yardTracks = (): Track[] => [...HAZARDS.map((h, i) => hazardTrack(h, i + 1)), wallTrack(99)];

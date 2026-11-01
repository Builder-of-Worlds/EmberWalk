import { type Hazard, iou, MIN_IOU, type Match, type Rect } from "./env.ts";

export type TruthCut = { fps: number; first: number };

export const FULL_WALK: TruthCut = { fps: 30, first: 1 };

export const truthFrame = (frame: number, fps: number, cut: TruthCut = FULL_WALK): number => Math.round((frame / fps) * cut.fps) + cut.first;

function boxesOf(hazard: Hazard): Map<number, Rect> {
  if (hazard.frame_boxes === undefined) throw new Error(`${hazard.id} has no per frame boxes; use the second yard's truth`);
  return new Map(hazard.frame_boxes.map((b) => [b.frame, { left: b.box_px[0], top: b.box_px[1], right: b.box_px[2], bottom: b.box_px[3] }]));
}

export function tightRect(hazard: Hazard, frame: number, fps: number, cut: TruthCut = FULL_WALK): Rect | null {
  return boxesOf(hazard).get(truthFrame(frame, fps, cut)) ?? null;
}

export function tightWindow(hazard: Hazard, frames: number, fps: number, cut: TruthCut = FULL_WALK): number[] {
  const boxes = boxesOf(hazard);
  return Array.from({ length: frames }, (_, f) => f).filter((f) => boxes.has(truthFrame(f, fps, cut)));
}

export function matchTight(hazard: Hazard, found: { frame: number; objects: { box: Rect }[] }[], frames: number, fps: number, cut: TruthCut = FULL_WALK): Match {
  const boxes = boxesOf(hazard);
  const window = tightWindow(hazard, frames, fps, cut);
  const bestIou = new Map<number, number>();
  const elsewhere: number[] = [];
  for (const f of found) {
    if (f.objects.length === 0) continue;
    const rect = boxes.get(truthFrame(f.frame, fps, cut));
    const best = rect === undefined ? 0 : Math.max(...f.objects.map((o) => iou(o.box, rect)));
    bestIou.set(f.frame, best);
    if (best < MIN_IOU) elsewhere.push(f.frame);
  }
  return { window, hits: window.filter((f) => (bestIou.get(f) ?? 0) >= MIN_IOU), elsewhere, bestIou };
}

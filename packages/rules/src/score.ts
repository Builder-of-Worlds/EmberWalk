import { z } from "zod";
import { Concept } from "@emberwalk/shared";
import type { RuleFinding } from "./evaluate.ts";

export const MIN_IOU = 0.5;

const Frame = z.int().nonnegative();
export const Rect = z
  .tuple([z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative(), z.number().nonnegative()])
  .refine(([left, top, right, bottom]) => left < right && top < bottom, "a box must have a positive width and height");
export type Rect = z.infer<typeof Rect>;

const distinct = (frames: number[]) => new Set(frames).size === frames.length;

export const HazardRecord = z
  .strictObject({
    id: z.string().trim().min(1).max(100),
    concept: Concept,
    window: z.array(Frame).max(10_000).refine(distinct, "a frame may appear once in the window"),
    truth: z.record(z.string().regex(/^\d+$/), Rect),
    found: z.array(z.strictObject({ frame: Frame, boxes: z.array(Rect).min(1).max(16) })).max(10_000),
  })
  .refine((h) => distinct(h.found.map((f) => f.frame)), { message: "a frame may appear once in found", path: ["found"] });
export type HazardRecord = z.infer<typeof HazardRecord>;

export const WalkRecord = z.strictObject({ hazards: z.array(HazardRecord).min(1).max(100) });
export type WalkRecord = z.infer<typeof WalkRecord>;

export type HazardScore = {
  id: string;
  concept: Concept;
  window: number;
  hits: number;
  misses: number;
  falseAlarms: number;
  found: boolean;
};

const area = ([l, t, r, b]: Rect) => Math.max(0, r - l) * Math.max(0, b - t);

export function iou(a: Rect, b: Rect): number {
  const inter = area([Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])]);
  return inter / (area(a) + area(b) - inter);
}

export function scoreHazard(record: HazardRecord): HazardScore {
  const h = HazardRecord.parse(record);
  const onHazard = new Set<number>();
  let falseAlarms = 0;
  for (const { frame, boxes } of h.found) {
    const truth = h.truth[String(frame)];
    const best = truth ? Math.max(...boxes.map((box) => iou(box, truth))) : 0;
    if (best >= MIN_IOU) onHazard.add(frame);
    else falseAlarms++;
  }
  const hits = h.window.filter((f) => onHazard.has(f)).length;
  return {
    id: h.id,
    concept: h.concept,
    window: h.window.length,
    hits,
    misses: h.window.length - hits,
    falseAlarms,
    found: h.window.length > 0 && hits >= Math.ceil(h.window.length / 2),
  };
}

export type FindingComparison = { hits: string[]; misses: string[]; falseAlarms: string[]; wrong: string[] };

const same = (a: RuleFinding, b: RuleFinding) => a.band === b.band && a.label === b.label && a.ruleIds.join() === b.ruleIds.join();

export function compareFindings(expected: RuleFinding[], got: RuleFinding[]): FindingComparison {
  const gotById = new Map(got.map((f) => [f.observationId, f]));
  const expectedIds = new Set(expected.map((f) => f.observationId));
  const result: FindingComparison = { hits: [], misses: [], falseAlarms: [], wrong: [] };
  for (const e of expected) {
    const g = gotById.get(e.observationId);
    if (!g) result.misses.push(e.observationId);
    else (same(e, g) ? result.hits : result.wrong).push(e.observationId);
  }
  result.falseAlarms = got.map((f) => f.observationId).filter((id) => !expectedIds.has(id));
  return result;
}

export function scoreWalk(record: WalkRecord): HazardScore[] {
  const walk = WalkRecord.parse(record);
  if (new Set(walk.hazards.map((h) => h.id)).size !== walk.hazards.length) throw new Error("every hazard needs its own id");
  return walk.hazards.map(scoreHazard);
}

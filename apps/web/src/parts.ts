import type { MotionSample } from "@emberwalk/shared";
import { CORNERS, cornersFor, turnBetween } from "./motion.ts";
import type { Side } from "./results.ts";

export type Part = { side: Side | null; startSeconds: number; endSeconds: number };

const LEFT_TURNS: readonly Side[] = ["front", "right", "back", "left"];
const RIGHT_TURNS: readonly Side[] = ["front", "left", "back", "right"];

export const GUIDED_ORDER = RIGHT_TURNS;

const guidedParts = (end: number, tapsMs: readonly number[]): Part[] => {
  const cuts = tapsMs.map((ms) => ms / 1000).filter((at) => at > 0 && at < end);
  const bounds = [0, ...cuts.slice(0, GUIDED_ORDER.length), end];
  return GUIDED_ORDER.slice(0, bounds.length - 1)
    .map((side, i) => ({ side, startSeconds: bounds[i] as number, endSeconds: bounds[i + 1] as number }))
    .filter((part) => part.endSeconds > part.startSeconds);
};

const usable = (motion: readonly MotionSample[], end: number): MotionSample[] => {
  const kept: MotionSample[] = [];
  for (const sample of motion) {
    const last = kept.at(-1);
    if (!Number.isFinite(sample.headingDegrees) || !(sample.t >= 0 && sample.t <= end)) continue;
    if (last === undefined || sample.t > last.t) kept.push(sample);
  }
  return kept;
};

export const walkOrder = (motion: readonly MotionSample[]): readonly Side[] => {
  const samples = usable(motion, Infinity);
  let net = 0;
  for (const [i, sample] of samples.entries()) {
    if (i === 0) continue;
    net += turnBetween((samples[i - 1] as MotionSample).headingDegrees, sample.headingDegrees);
    if (cornersFor(net) > 0) return Math.sign(net) === -1 ? LEFT_TURNS : RIGHT_TURNS;
  }
  return LEFT_TURNS;
};

export const partsOf = (durationMs: number, motion: readonly MotionSample[], nextTaps: readonly number[] = []): Part[] => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  const end = durationMs / 1000;
  const samples = usable(motion, end);
  if (samples.length < 2 && nextTaps.length > 0) return guidedParts(end, nextTaps);
  if (samples.length < 2) return [{ side: null, startSeconds: 0, endSeconds: end }];

  const order = walkOrder(samples);
  const starts = [{ corner: 0, at: 0 }];
  let net = 0;
  let reached = 0;
  for (const [i, sample] of samples.entries()) {
    if (i === 0) continue;
    net += turnBetween((samples[i - 1] as MotionSample).headingDegrees, sample.headingDegrees);
    const corners = cornersFor(net);
    if (corners <= reached) continue;
    reached = corners;
    const last = starts.at(-1) as { at: number };
    if (corners < CORNERS && sample.t > last.at && sample.t < end) starts.push({ corner: corners, at: sample.t });
  }
  return starts.map(({ corner, at }, i) => ({
    side: order[corner] as Side,
    startSeconds: at,
    endSeconds: starts[i + 1]?.at ?? end,
  }));
};

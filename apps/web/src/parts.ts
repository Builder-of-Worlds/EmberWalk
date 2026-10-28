import type { MotionSample } from "@emberwalk/shared";
import { CORNERS, cornersFor, turnBetween } from "./motion.ts";
import type { Side } from "./results.ts";

export type Part = { side: Side | null; startSeconds: number; endSeconds: number };

const LEFT_TURNS: readonly Side[] = ["front", "right", "back", "left"];
const RIGHT_TURNS: readonly Side[] = ["front", "left", "back", "right"];

const usable = (motion: readonly MotionSample[], end: number): MotionSample[] => {
  const kept: MotionSample[] = [];
  for (const sample of motion) {
    const last = kept.at(-1);
    if (!Number.isFinite(sample.headingDegrees) || !(sample.t >= 0 && sample.t <= end)) continue;
    if (last === undefined || sample.t > last.t) kept.push(sample);
  }
  return kept;
};

export const partsOf = (durationMs: number, motion: readonly MotionSample[]): Part[] => {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];
  const end = durationMs / 1000;
  const samples = usable(motion, end);
  if (samples.length < 2) return [{ side: null, startSeconds: 0, endSeconds: end }];

  const starts = [{ corner: 0, at: 0 }];
  let net = 0;
  let reached = 0;
  let order = LEFT_TURNS;
  for (const [i, sample] of samples.entries()) {
    if (i === 0) continue;
    net += turnBetween((samples[i - 1] as MotionSample).headingDegrees, sample.headingDegrees);
    const corners = cornersFor(net);
    if (corners <= reached) continue;
    if (reached === 0) order = net < 0 ? LEFT_TURNS : RIGHT_TURNS;
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

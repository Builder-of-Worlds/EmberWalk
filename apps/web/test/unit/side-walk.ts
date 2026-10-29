import type { MotionSample, Side } from "@emberwalk/shared";
import type { Pan } from "../../src/take-store.ts";

const EVERY = 0.5;
const LEG = 10;
const TURN = 2;
const STEP_OUT = 2;
const PAN = 4;
const LOOP_LIGHT = [150, 120, 90, 135];
const PAN_SIDES: Side[] = ["front", "left", "back", "right"];

const norm = (degrees: number) => ((degrees % 360) + 360) % 360;

export const sideWalkTake = (): { durationMs: number; motion: MotionSample[]; pans: Pan[] } => {
  const motion: MotionSample[] = [];
  let t = 0;
  const take = (headingDegrees: number, tiltDegrees: number, light: number) => {
    motion.push({ t, tiltDegrees, headingDegrees: norm(headingDegrees), light });
    t += EVERY;
  };
  for (let leg = 0; leg < 4; leg++) {
    for (let s = 0; s < LEG; s += EVERY) take(90 * leg, 15, LOOP_LIGHT[leg]!);
    for (let s = EVERY; s <= TURN; s += EVERY) take(90 * leg + (90 * s) / TURN, 15, LOOP_LIGHT[leg]!);
  }
  const pans: Pan[] = [];
  for (const [k, side] of PAN_SIDES.entries()) {
    for (let s = 0; s < STEP_OUT; s += EVERY) take(90 * k, 5, 140);
    const startMs = t * 1000;
    for (let s = 0; s < PAN; s += EVERY) take(90 * k - 60 + (120 * s) / PAN, 5, 160 - 10 * k);
    pans.push({ side, startMs, endMs: t * 1000 });
  }
  take(0, 5, 140);
  return { durationMs: t * 1000, motion, pans };
};

import type { Band, Clip, MotionSample } from "@emberwalk/shared";
import { bandFor } from "./lookup.ts";

export const LONG_SIDE_FOV_DEGREES = 69.39;
export const CAMERA_HEIGHT_FEET = 4.5;
export const HEIGHT_ERROR_FEET = 0.5;
export const TILT_ERROR_DEGREES = 1.5;
export const TILT_GAP_SECONDS = 0.25;

export type View = { tiltBelowHorizonDegrees: number; verticalFovDegrees: number; cameraHeightFeet: number };
export type FeetRange = { low: number; high: number };

const radians = (degrees: number) => (degrees * Math.PI) / 180;

const refuse = (y: number, view: View) => {
  if (!(y >= 0 && y <= 1)) throw new RangeError(`a picture height must be 0 to 1: ${y}`);
  const tilt = view.tiltBelowHorizonDegrees;
  if (!(tilt >= -90 && tilt <= 90)) throw new RangeError(`a tilt must be -90 to 90 degrees: ${tilt}`);
  if (!(view.verticalFovDegrees > 0 && view.verticalFovDegrees < 180)) throw new RangeError(`a field of view must be 0 to 180 degrees: ${view.verticalFovDegrees}`);
  if (!(view.cameraHeightFeet > 0)) throw new RangeError(`a camera height must be above the ground: ${view.cameraHeightFeet}`);
};

export const depthFeet = (y: number, view: View): number | null => {
  refuse(y, view);
  const below = radians(view.tiltBelowHorizonDegrees) + Math.atan((y - 0.5) * 2 * Math.tan(radians(view.verticalFovDegrees) / 2));
  return below <= 0 ? null : view.cameraHeightFeet / Math.tan(below);
};

const corners = (view: View): View[] =>
  [-TILT_ERROR_DEGREES, TILT_ERROR_DEGREES].flatMap((tilt) =>
    [-HEIGHT_ERROR_FEET, HEIGHT_ERROR_FEET].map((height) => ({
      verticalFovDegrees: view.verticalFovDegrees,
      tiltBelowHorizonDegrees: Math.max(-90, Math.min(90, tilt + view.tiltBelowHorizonDegrees)),
      cameraHeightFeet: height + view.cameraHeightFeet,
    })),
  );

const spread = (values: (number | null)[]): FeetRange | null =>
  values.some((v) => v === null) ? null : { low: Math.max(0, Math.min(...(values as number[]))), high: Math.max(0, ...(values as number[])) };

export const groundFeet = ({ y, ...view }: View & { y: number }): FeetRange | null => {
  if (depthFeet(y, view) === null) return null;
  return spread(corners(view).map((corner) => depthFeet(y, corner)));
};

export const verticalFov = (clip: Pick<Clip, "width" | "height">): number =>
  (2 * Math.atan(Math.tan(radians(LONG_SIDE_FOV_DEGREES) / 2) * Math.min(1, clip.height / clip.width)) * 180) / Math.PI;

export const sampleNear = (samples: readonly MotionSample[], t: number): MotionSample | null => {
  let best: MotionSample | null = null;
  for (const sample of samples) if (best === null || Math.abs(sample.t - t) < Math.abs(best.t - t)) best = sample;
  return best !== null && Math.abs(best.t - t) <= TILT_GAP_SECONDS ? best : null;
};

export const tiltAt = (samples: readonly MotionSample[], t: number): number | null => sampleNear(samples, t)?.tiltDegrees ?? null;

export type Placed = { distanceFeet: FeetRange; band: Band };

export type Seen = { kind: "loop"; y: number; wallY: number } | { kind: "pan"; y: number; homeFeet: FeetRange };

export const feetFromWall = (seen: Seen, view: View): FeetRange | null => {
  if (seen.kind === "loop") {
    refuse(seen.y, view);
    refuse(seen.wallY, view);
    return spread(
      corners(view).map((corner) => {
        const wall = depthFeet(seen.wallY, corner);
        const object = depthFeet(seen.y, corner);
        return wall === null || object === null ? null : wall - object;
      }),
    );
  }
  const ground = groundFeet({ y: seen.y, ...view });
  return ground === null ? null : { low: seen.homeFeet.low + ground.low, high: seen.homeFeet.high + ground.high };
};

export const fromWall = (seen: Seen, view: View): Placed | null => {
  const distanceFeet = feetFromWall(seen, view);
  if (distanceFeet === null) return null;
  const band = bandFor(distanceFeet);
  return band === null ? null : { distanceFeet, band };
};

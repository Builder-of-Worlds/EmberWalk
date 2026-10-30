import { describe, expect, it } from "vitest";
import {
  CAMERA_HEIGHT_FEET,
  depthFeet,
  feetFromWall,
  fromWall,
  groundFeet,
  HEIGHT_ERROR_FEET,
  LONG_SIDE_FOV_DEGREES,
  tiltAt,
  TILT_ERROR_DEGREES,
  TILT_GAP_SECONDS,
  verticalFov,
} from "../src/index.ts";
import { CAMERA, CAMERA_HEIGHT_IN, cameraToHazardFeet, HAZARDS, MOTION, sampleAt, spreadFrames, unit, wallRow } from "./yard.ts";

const DISTANCE_TOLERANCE = 0.2;

const viewAt = (frame: number) => ({
  tiltBelowHorizonDegrees: tiltAt(MOTION, sampleAt(frame).t)!,
  verticalFovDegrees: verticalFov(CAMERA),
  cameraHeightFeet: CAMERA_HEIGHT_IN / 12,
});

const LEVEL = { tiltBelowHorizonDegrees: 20, verticalFovDegrees: 40, cameraHeightFeet: CAMERA_HEIGHT_FEET };

describe("groundFeet on test yard 2", () => {
  for (const hazard of HAZARDS)
    it(`puts the bottom of the ${hazard.id} box at its camera distance on five spread frames`, () => {
      for (const { frame, box_px } of spreadFrames(hazard)) {
        const y = unit(box_px)[3];
        const truth = cameraToHazardFeet(hazard, frame);
        const nominal = depthFeet(y, viewAt(frame))!;
        expect(Math.abs(nominal - truth) / truth, `${hazard.id} frame ${frame}`).toBeLessThan(DISTANCE_TOLERANCE);
        const range = groundFeet({ y, ...viewAt(frame) })!;
        expect(range.low).toBeLessThan(nominal);
        expect(range.high).toBeGreaterThan(nominal);
      }
    });

  it("gives the wood pile and the dry brush their truth bands from the wall", () => {
    for (const hazard of HAZARDS.filter((h) => h.id !== "fence-joint-1"))
      for (const { frame, box_px } of spreadFrames(hazard)) {
        const placed = fromWall({ kind: "loop", y: unit(box_px)[3], wallY: wallRow(frame) }, viewAt(frame));
        expect(placed?.band, `${hazard.id} frame ${frame}`).toBe(hazard.truthBand);
      }
  });

  it("places the fence by the near end of its box, past five feet, so its truth band waits on contact", () => {
    const fence = HAZARDS.find((h) => h.id === "fence-joint-1")!;
    expect(fence.truthBand).toBe("zone_0");
    for (const { frame, box_px } of spreadFrames(fence)) {
      const placed = fromWall({ kind: "loop", y: unit(box_px)[3], wallY: wallRow(frame) }, viewAt(frame));
      expect(placed?.band, `frame ${frame}`).toBe("zone_1");
    }
  });
});

describe("groundFeet", () => {
  it("is null at or above the horizon, and when an uncertain tilt reaches it", () => {
    expect(groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: 0 })).toBeNull();
    expect(groundFeet({ y: 0, ...LEVEL, tiltBelowHorizonDegrees: 10 })).toBeNull();
    expect(groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: 1 })).toBeNull();
    expect(groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: -30 })).toBeNull();
  });

  it("looks straight down to almost nothing, and widens its range with the camera height error", () => {
    const down = groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: 89 })!;
    expect(down.high).toBeLessThan(0.3);
    const range = groundFeet({ y: 0.5, ...LEVEL })!;
    const nominal = CAMERA_HEIGHT_FEET / Math.tan((20 * Math.PI) / 180);
    expect(range.low).toBeLessThan(nominal * ((CAMERA_HEIGHT_FEET - HEIGHT_ERROR_FEET) / CAMERA_HEIGHT_FEET));
    expect(range.high).toBeGreaterThan(nominal * ((CAMERA_HEIGHT_FEET + HEIGHT_ERROR_FEET) / CAMERA_HEIGHT_FEET));
  });

  it("refuses a picture height outside 0 to 1, a tilt outside -90 to 90, and a bad lens or height", () => {
    for (const y of [-0.01, 1.01, Number.NaN]) expect(() => groundFeet({ y, ...LEVEL }), String(y)).toThrow(RangeError);
    for (const tilt of [-90.5, 91, Number.NaN]) expect(() => groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: tilt }), String(tilt)).toThrow(RangeError);
    expect(() => groundFeet({ y: 0.5, ...LEVEL, verticalFovDegrees: 0 })).toThrow(RangeError);
    expect(() => groundFeet({ y: 0.5, ...LEVEL, cameraHeightFeet: 0 })).toThrow(RangeError);
    expect(() => fromWall({ kind: "loop", y: 0.6, wallY: 1.2 }, LEVEL)).toThrow(RangeError);
  });

  it("accepts the edges themselves: the bottom row of the picture and a tilt of -90 degrees", () => {
    expect(groundFeet({ y: 1, ...LEVEL })).not.toBeNull();
    expect(groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: -90 })).toBeNull();
  });

  it("accepts a very narrow lens and a camera held low", () => {
    expect(depthFeet(0.5, { ...LEVEL, tiltBelowHorizonDegrees: 20, verticalFovDegrees: 0.5 })).not.toBeNull();
    expect(depthFeet(0.5, { ...LEVEL, tiltBelowHorizonDegrees: 20, cameraHeightFeet: 0.5 })).not.toBeNull();
    expect(groundFeet({ y: 0.5, ...LEVEL, tiltBelowHorizonDegrees: 20, cameraHeightFeet: 1 })).not.toBeNull();
  });

  it("spreads a camera tipped above the horizon by the tilt error each way", () => {
    const view = { verticalFovDegrees: 60, cameraHeightFeet: 4.5 };
    const range = groundFeet({ y: 1, ...view, tiltBelowHorizonDegrees: -10 })!;
    const nearest = depthFeet(1, { ...view, tiltBelowHorizonDegrees: -10 + TILT_ERROR_DEGREES, cameraHeightFeet: 4.5 - HEIGHT_ERROR_FEET })!;
    const farthest = depthFeet(1, { ...view, tiltBelowHorizonDegrees: -10 - TILT_ERROR_DEGREES, cameraHeightFeet: 4.5 + HEIGHT_ERROR_FEET })!;
    expect(range.low).toBeCloseTo(nearest, 6);
    expect(range.high).toBeCloseTo(farthest, 6);
  });

  it("returns null rather than throwing when the tilt error pushes a tilt of -89.9 past -90", () => {
    expect(groundFeet({ y: 1, verticalFovDegrees: 179.9, cameraHeightFeet: 4.5, tiltBelowHorizonDegrees: -89.9 })).toBeNull();
    expect(() => groundFeet({ y: 0.5, verticalFovDegrees: 179.9, cameraHeightFeet: 4.5, tiltBelowHorizonDegrees: 89.9 })).not.toThrow();
  });

  it("refuses a field of view of 180 degrees, and a camera height of zero even for one depth", () => {
    expect(() => groundFeet({ y: 0.5, ...LEVEL, verticalFovDegrees: 180 })).toThrow(RangeError);
    expect(() => depthFeet(0.5, { ...LEVEL, cameraHeightFeet: 0 })).toThrow(RangeError);
  });
});

describe("depthFeet", () => {
  it("gives no depth for a point exactly on the horizon", () => {
    expect(depthFeet(0.5, { ...LEVEL, tiltBelowHorizonDegrees: 0 })).toBeNull();
  });
});

describe("fromWall", () => {
  it("sends a range that crosses five feet to the closer band", () => {
    const placed = fromWall({ kind: "pan", y: 0.5, homeFeet: { low: 2, high: 3 } }, { ...LEVEL, tiltBelowHorizonDegrees: 60 })!;
    expect(placed.distanceFeet.low).toBeLessThan(5);
    expect(placed.distanceFeet.high).toBeGreaterThan(5);
    expect(placed.band).toBe("zone_0");
  });

  it("adds the homeowner's distance from the wall to a pan object's ground distance", () => {
    const ground = groundFeet({ y: 0.7, ...LEVEL })!;
    expect(fromWall({ kind: "pan", y: 0.7, homeFeet: { low: 10, high: 12 } }, LEVEL)?.distanceFeet).toEqual({ low: ground.low + 10, high: ground.high + 12 });
  });

  it("puts an object at or behind the wall line at zero feet", () => {
    expect(fromWall({ kind: "loop", y: 0.6, wallY: 0.7 }, LEVEL)?.distanceFeet).toEqual({ low: 0, high: 0 });
  });

  it("drops an object past 100 feet, and one whose wall is at the horizon", () => {
    expect(fromWall({ kind: "pan", y: 0.7, homeFeet: { low: 99, high: 99 } }, LEVEL)).toBeNull();
    expect(fromWall({ kind: "loop", y: 0.9, wallY: 0.5 }, { ...LEVEL, tiltBelowHorizonDegrees: 1 })).toBeNull();
  });
});

describe("feetFromWall out to 30 feet on a pinhole picture", () => {
  const FEET_OUT = [0, 2, 5, 10, 15, 20, 30];
  const BEHIND = [8, 10, 15];
  const EDGE = 1e-9;
  const fov = verticalFov(CAMERA);
  const radians = (degrees: number) => (degrees * Math.PI) / 180;
  const pictureY = (depth: number, tilt: number, height: number) => 0.5 + Math.tan(Math.atan(height / depth) - radians(tilt)) / (2 * Math.tan(radians(fov) / 2));
  const readTilt = (out: number, behind: number) => ((Math.atan(CAMERA_HEIGHT_FEET / (out + behind)) + Math.atan(CAMERA_HEIGHT_FEET / behind)) * 90) / Math.PI;
  const worlds = [-HEIGHT_ERROR_FEET, 0, HEIGHT_ERROR_FEET].flatMap((height) => [-TILT_ERROR_DEGREES, 0, TILT_ERROR_DEGREES].map((tilt) => ({ height, tilt })));

  const measure = (out: number, behind: number, world: { height: number; tilt: number }) => {
    const tilt = readTilt(out, behind);
    const height = CAMERA_HEIGHT_FEET + world.height;
    const seen = { kind: "loop" as const, y: pictureY(behind, tilt + world.tilt, height), wallY: pictureY(out + behind, tilt + world.tilt, height) };
    return feetFromWall(seen, { tiltBelowHorizonDegrees: tilt, verticalFovDegrees: fov, cameraHeightFeet: CAMERA_HEIGHT_FEET });
  };

  it("holds the true distance at every distance out to 30 feet, for every height and tilt inside their errors", () => {
    for (const out of FEET_OUT)
      for (const behind of BEHIND)
        for (const world of worlds) {
          const range = measure(out, behind, world)!;
          const where = `${out} feet out, ${behind} behind, height ${world.height}, tilt ${world.tilt}`;
          expect(range.low, where).toBeLessThanOrEqual(out + EDGE);
          expect(range.high, where).toBeGreaterThanOrEqual(out - EDGE);
        }
  });

  it("sends at most 30 to 114 feet for a thing 30 feet out, and at most 2 to 4 feet for one 2 feet out", () => {
    const widest = (out: number) => worlds.flatMap((world) => BEHIND.map((behind) => measure(out, behind, world)!)).reduce((a, b) => (b.high - b.low > a.high - a.low ? b : a));
    expect(widest(30).low).toBeCloseTo(30, 6);
    expect(widest(30).high).toBeCloseTo(114, 0);
    expect(widest(2).low).toBeCloseTo(2, 6);
    expect(widest(2).high).toBeCloseTo(4, 0);
  });

  it("gives null for an object at or above the horizon", () => {
    const tilt = 10;
    const view = { tiltBelowHorizonDegrees: tilt, verticalFovDegrees: fov, cameraHeightFeet: CAMERA_HEIGHT_FEET };
    const horizon = 0.5 - Math.tan(radians(tilt)) / (2 * Math.tan(radians(fov) / 2));
    for (const y of [horizon, horizon - 0.01]) expect(feetFromWall({ kind: "loop", y, wallY: pictureY(15, tilt, CAMERA_HEIGHT_FEET) }, view), String(y)).toBeNull();
  });

  it("never sends a negative edge for an object at or past the wall line", () => {
    for (const past of [0, 0.25, 2])
      for (const world of worlds) {
        const tilt = readTilt(10, 5);
        const height = CAMERA_HEIGHT_FEET + world.height;
        const seen = { kind: "loop" as const, y: pictureY(15 + past, tilt + world.tilt, height), wallY: pictureY(15, tilt + world.tilt, height) };
        const range = feetFromWall(seen, { tiltBelowHorizonDegrees: tilt, verticalFovDegrees: fov, cameraHeightFeet: CAMERA_HEIGHT_FEET })!;
        expect(range, `${past} past`).toEqual({ low: 0, high: 0 });
      }
  });
});

describe("verticalFov and tiltAt", () => {
  it("uses the long side's field of view for portrait and the short side's share for landscape", () => {
    expect(verticalFov({ width: 1080, height: 1920 })).toBe(LONG_SIDE_FOV_DEGREES);
    expect(verticalFov({ width: 1080, height: 1080 })).toBe(LONG_SIDE_FOV_DEGREES);
    expect(verticalFov(CAMERA)).toBeCloseTo(CAMERA.vfovDegrees, 2);
  });

  it("picks the nearest motion sample, and gives null rather than a guess when none is near", () => {
    const samples = [
      { t: 1, tiltDegrees: 10, headingDegrees: 0 },
      { t: 2, tiltDegrees: 20, headingDegrees: 0 },
    ];
    expect(tiltAt(samples, 1.2)).toBe(10);
    expect(tiltAt(samples, 1.8)).toBe(20);
    expect(tiltAt(samples, 2 + TILT_GAP_SECONDS)).toBe(20);
    expect(tiltAt(samples, 2 + TILT_GAP_SECONDS + 0.01)).toBeNull();
    expect(tiltAt(samples, 0.5)).toBeNull();
    expect(tiltAt([], 1)).toBeNull();
  });

  it("takes the earlier of two samples equally near", () => {
    const samples = [
      { t: 1, tiltDegrees: 10, headingDegrees: 0 },
      { t: 1.5, tiltDegrees: 20, headingDegrees: 0 },
    ];
    expect(tiltAt(samples, 1.25)).toBe(10);
  });
});

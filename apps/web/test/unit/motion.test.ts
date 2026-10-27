import { describe, expect, it, vi } from "vitest";
import { askMotion, bearingFrom, browserMotion, cornersFor, turnBetween } from "../../src/motion.ts";
import type { MotionEnv } from "../../src/motion.ts";

describe("bearingFrom", () => {
  it("reads the compass heading on iPhone and the turned alpha elsewhere", () => {
    expect(bearingFrom({ alpha: 10, beta: 70, webkitCompassHeading: 275 })).toEqual({ headingDegrees: 275, tiltDegrees: 20 });
    expect(bearingFrom({ alpha: 90, beta: 120 })).toEqual({ headingDegrees: 270, tiltDegrees: -30 });
  });

  it("turns beta into degrees below the horizon, level at 90 and straight down at 0", () => {
    expect(bearingFrom({ alpha: 0, beta: 90 })?.tiltDegrees).toBe(0);
    expect(bearingFrom({ alpha: 0, beta: 72.5 })?.tiltDegrees).toBe(17.5);
    expect(bearingFrom({ alpha: 0, beta: 0 })?.tiltDegrees).toBe(90);
    expect(bearingFrom({ alpha: 0, beta: 180 })?.tiltDegrees).toBe(-90);
    expect(bearingFrom({ alpha: 0, beta: -90 })?.tiltDegrees).toBe(180);
    expect(bearingFrom({ alpha: 0, beta: -135 })?.tiltDegrees).toBe(-135);
    expect(bearingFrom({ alpha: 0, beta: -180 })?.tiltDegrees).toBe(-90);
  });

  it("gives nothing when beta is missing or out of range", () => {
    expect(bearingFrom({ alpha: 0, beta: null })).toBeNull();
    expect(bearingFrom({ alpha: 0, beta: 180.5 })).toBeNull();
    expect(bearingFrom({ alpha: 0, beta: -181 })).toBeNull();
    expect(bearingFrom({ alpha: 0, beta: Number.NaN })).toBeNull();
  });

  it("gives nothing when the phone reports no heading", () => {
    expect(bearingFrom({ alpha: null, beta: 10 })).toBeNull();
    expect(bearingFrom({ alpha: Number.NaN, beta: 10 })).toBeNull();
  });

  it("keeps heading in 0 to under 360", () => {
    expect(bearingFrom({ alpha: 0, beta: 90, webkitCompassHeading: 360 })).toEqual({ headingDegrees: 0, tiltDegrees: 0 });
    expect(bearingFrom({ alpha: 0, beta: 90, webkitCompassHeading: -90 })).toEqual({ headingDegrees: 270, tiltDegrees: 0 });
  });
});

describe("turnBetween and cornersFor", () => {
  it("takes the short way round across north", () => {
    expect(turnBetween(350, 10)).toBe(20);
    expect(turnBetween(10, 350)).toBe(-20);
    expect(turnBetween(0, 180)).toBe(180);
    expect(turnBetween(90, 90)).toBe(0);
  });

  it("counts a corner for each quarter turn either way, up to four", () => {
    expect(cornersFor(89.9)).toBe(0);
    expect(cornersFor(90)).toBe(1);
    expect(cornersFor(-185)).toBe(2);
    expect(cornersFor(359)).toBe(3);
    expect(cornersFor(900)).toBe(4);
  });
});

const env = (requestPermission?: () => Promise<string>): MotionEnv => ({ requestPermission, listen: () => () => undefined });

describe("askMotion", () => {
  it("uses motion where no permission is needed, and when it is granted", async () => {
    expect(await askMotion(env())).not.toBeNull();
    expect(await askMotion(env(async () => "granted"))).not.toBeNull();
  });

  it("goes on without motion when refused, when asking fails, or when the phone has none", async () => {
    expect(await askMotion(env(async () => "denied"))).toBeNull();
    expect(await askMotion(env(() => Promise.reject(new Error("not from a tap"))))).toBeNull();
    expect(await askMotion(null)).toBeNull();
  });
});

describe("browserMotion", () => {
  it("has no motion without DeviceOrientationEvent", () => {
    expect(browserMotion(new EventTarget() as unknown as Window)).toBeNull();
  });

  it("passes on each heading until it stops listening", () => {
    const target = Object.assign(new EventTarget(), { DeviceOrientationEvent: {} });
    const motion = browserMotion(target as unknown as Window);
    expect(motion?.requestPermission).toBeUndefined();
    const seen = vi.fn();
    const stop = motion?.listen(seen);
    target.dispatchEvent(Object.assign(new Event("deviceorientation"), { alpha: 30, beta: 5 }));
    target.dispatchEvent(Object.assign(new Event("deviceorientation"), { alpha: null, beta: 5 }));
    stop?.();
    target.dispatchEvent(Object.assign(new Event("deviceorientation"), { alpha: 60, beta: 5 }));
    expect(seen.mock.calls).toEqual([[{ headingDegrees: 330, tiltDegrees: 85 }]]);
  });

  it("asks through the phone's own permission call where there is one", async () => {
    const requestPermission = vi.fn(async () => "granted");
    const target = Object.assign(new EventTarget(), { DeviceOrientationEvent: { requestPermission } });
    expect(await browserMotion(target as unknown as Window)?.requestPermission?.()).toBe("granted");
    expect(requestPermission).toHaveBeenCalledOnce();
  });
});

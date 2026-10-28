import { describe, expect, it } from "vitest";
import { DEFAULT_LIMITS, Limits, limitsWith, maxWalkBytes, uploadMaxParts } from "../src/index.ts";
import { refuses, refusesEach, refusesMissingAndExtra, roundTrips } from "./check.ts";

const MiB = 1024 * 1024;

describe("limits", () => {
  it("holds the decided defaults", () => {
    expect(DEFAULT_LIMITS).toEqual({
      dailySpendUsd: 20,
      liveWalksPerVisitorPerDay: 3,
      maxFps: 4,
      defaultFps: 2,
      maxWalkSeconds: 360,
      maxVideoBitsPerSecond: 24_000_000,
      uploadPartBytes: 10 * MiB,
      uploadMinPartBytes: 5 * MiB,
      uploadLinkTtlSeconds: 900,
      uploadSessionTtlSeconds: 7200,
      uploadMaxTriesPerPart: 3,
      maxObjectsPerFrame: 16,
      faultCountMost: 1000,
      faultKeepDays: 30,
      faultRowsADay: 500,
    });
    roundTrips(Limits, DEFAULT_LIMITS);
  });

  it("derives the walk size and part count from the walk length", () => {
    expect(maxWalkBytes(DEFAULT_LIMITS)).toBe(1_080_000_000);
    expect(uploadMaxParts(DEFAULT_LIMITS)).toBe(103);
    expect(maxWalkBytes(limitsWith({ maxWalkSeconds: 1, maxVideoBitsPerSecond: 9 }))).toBe(2);
    expect(uploadMaxParts(limitsWith({ maxWalkSeconds: 8, maxVideoBitsPerSecond: 10 * MiB, uploadPartBytes: 10 * MiB }))).toBe(1);
    expect(uploadMaxParts(limitsWith({ maxWalkSeconds: 8, maxVideoBitsPerSecond: 10 * MiB + 1, uploadPartBytes: 10 * MiB }))).toBe(2);
  });

  it("can be raised in one place", () => {
    expect(limitsWith({ maxFps: 8 }).maxFps).toBe(8);
    expect(limitsWith({}).maxFps).toBe(4);
  });

  it("accepts the edges of each relation", () => {
    expect(limitsWith({ defaultFps: 4 }).defaultFps).toBe(4);
    expect(limitsWith({ uploadPartBytes: 5 * MiB }).uploadPartBytes).toBe(5 * MiB);
    expect(limitsWith({ uploadLinkTtlSeconds: 7200 }).uploadLinkTtlSeconds).toBe(7200);
  });

  it("refuses limits that contradict each other", () => {
    expect(() => limitsWith({ defaultFps: 4.5 })).toThrow(/defaultFps/);
    expect(() => limitsWith({ uploadPartBytes: 5 * MiB - 1 })).toThrow(/uploadMinPartBytes/);
    expect(() => limitsWith({ uploadLinkTtlSeconds: 7201 })).toThrow(/outlive/);
  });

  it("refuses missing, extra, zero, negative and fractional counts", () => {
    refusesMissingAndExtra(Limits, DEFAULT_LIMITS);
    refusesEach(Limits, DEFAULT_LIMITS, [
      { dailySpendUsd: 0 },
      { liveWalksPerVisitorPerDay: 0 },
      { maxFps: -1 },
      { maxWalkSeconds: 1.5 },
      { uploadMaxTriesPerPart: "3" },
    ]);
    refuses(Limits, { ...DEFAULT_LIMITS, maxObjectsPerFrame: 0 });
  });

  it("refuses a zero, negative or fractional fault limit", () => {
    for (const key of ["faultCountMost", "faultKeepDays", "faultRowsADay"]) {
      refusesEach(Limits, DEFAULT_LIMITS, [{ [key]: 0 }, { [key]: -1 }, { [key]: 1.5 }, { [key]: "5" }]);
      expect(limitsWith({ [key]: 1 })[key as "faultCountMost"]).toBe(1);
    }
  });
});

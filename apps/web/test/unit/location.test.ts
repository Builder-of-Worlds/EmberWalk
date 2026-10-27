import { Jurisdiction as SharedJurisdiction } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { browserLocate, isJurisdiction, JURISDICTIONS, jurisdictionFor, LOCATE_TIMEOUT_MS } from "../../src/location.ts";

const at = (latitude: number, longitude: number) => ({ latitude, longitude });

describe("jurisdiction codes", () => {
  it("are the three D-98 codes, each valid in the shared contract", () => {
    expect(JURISDICTIONS).toEqual(["ca", "ca_sra", "ca_vhfhsz"]);
    for (const code of JURISDICTIONS) expect(SharedJurisdiction.parse(code)).toBe(code);
  });

  it("accepts only those codes", () => {
    expect(isJurisdiction("ca_sra")).toBe(true);
    for (const value of ["", "CA", "ca_lra", "or", null, 3]) expect(isJurisdiction(value)).toBe(false);
  });
});

describe("jurisdictionFor", () => {
  it("finds California for houses across the state", () => {
    for (const spot of [at(38.58, -121.49), at(34.05, -118.24), at(32.72, -117.16), at(40.8, -124.16), at(41.73, -122.63), at(38.94, -119.98), at(33.0, -118.5)]) {
      expect(jurisdictionFor(spot)).toBe("ca");
    }
  });

  it("finds nothing outside California", () => {
    for (const spot of [at(39.53, -119.81), at(36.17, -115.14), at(45.52, -122.68), at(32.69, -114.62), at(32.51, -117.04), at(42.2, -122.7)]) {
      expect(jurisdictionFor(spot)).toBeNull();
    }
  });
});

const geolocation = (answer: { at?: [number, number]; code?: number }) => ({
  asked: [] as PositionOptions[],
  getCurrentPosition(ok: PositionCallback, fail?: PositionErrorCallback | null, options?: PositionOptions) {
    this.asked.push(options ?? {});
    if (answer.at !== undefined) ok({ coords: { latitude: answer.at[0], longitude: answer.at[1] } } as GeolocationPosition);
    else fail?.({ code: answer.code ?? 2 } as GeolocationPositionError);
  },
});

describe("browserLocate", () => {
  it("gives the phone's point, asking once with a time limit", async () => {
    const geo = geolocation({ at: [38.5, -121.5] });
    expect(await browserLocate(geo)()).toEqual(at(38.5, -121.5));
    expect(geo.asked).toEqual([expect.objectContaining({ timeout: LOCATE_TIMEOUT_MS })]);
  });

  it("says denied when the homeowner refuses, unavailable otherwise, unsupported with no location at all", async () => {
    expect(await browserLocate(geolocation({ code: 1 }))()).toEqual({ refusal: "denied" });
    expect(await browserLocate(geolocation({ code: 2 }))()).toEqual({ refusal: "unavailable" });
    expect(await browserLocate(geolocation({ code: 3 }))()).toEqual({ refusal: "unavailable" });
    expect(await browserLocate(undefined)()).toEqual({ refusal: "unsupported" });
  });
});

import { CaJurisdiction } from "@emberwalk/rules";
import { Jurisdiction as SharedJurisdiction } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { browserLocate, CALIFORNIA, isJurisdiction, JURISDICTIONS, jurisdictionAt, LOCATE_TIMEOUT_MS, locateRules, RULE_AREAS } from "../../src/location.ts";
import type { RuleArea } from "../../src/location.ts";

const at = (latitude: number, longitude: number) => ({ latitude, longitude });

describe("jurisdiction codes", () => {
  it("are the three location codes, each valid in the shared contract", () => {
    expect(JURISDICTIONS).toEqual(["ca", "ca_sra", "ca_vhfhsz"]);
    for (const code of JURISDICTIONS) expect(SharedJurisdiction.parse(code)).toBe(code);
  });

  it("are each a key the rules engine accepts, for every code the phone can find or keep", () => {
    for (const code of JURISDICTIONS) expect(CaJurisdiction.safeParse(code).success).toBe(true);
    for (const area of RULE_AREAS) expect(CaJurisdiction.safeParse(area.key).success).toBe(true);
  });

  it("accepts only those codes", () => {
    expect(isJurisdiction("ca_sra")).toBe(true);
    for (const value of ["", "CA", "ca_lra", "or", null, 3]) expect(isJurisdiction(value)).toBe(false);
  });
});

describe("jurisdictionAt", () => {
  it("finds California for houses across the state", () => {
    for (const spot of [at(38.58, -121.49), at(34.05, -118.24), at(32.72, -117.16), at(40.8, -124.16), at(41.73, -122.63), at(38.94, -119.98), at(33.0, -118.5)]) {
      expect(jurisdictionAt(spot)).toBe("ca");
    }
  });

  it("finds nothing outside California", () => {
    for (const spot of [at(39.53, -119.81), at(36.17, -115.14), at(45.52, -122.68), at(32.69, -114.62), at(32.51, -117.04), at(42.2, -122.7)]) {
      expect(jurisdictionAt(spot)).toBeNull();
    }
  });

  it("finds nothing for synthetic points in central Nevada, the Pacific off San Francisco and northern Baja", () => {
    for (const spot of [at(39.0, -117.0), at(37.7, -123.6), at(31.0, -115.8)]) expect(jurisdictionAt(spot)).toBeNull();
  });

  it("gives ca for a synthetic point in the Central Valley", () => {
    expect(jurisdictionAt(at(36.8, -119.8))).toBe("ca");
  });

  it("refuses a spot that is not a real coordinate, never throwing", () => {
    for (const spot of [at(91, -119.8), at(-91, -119.8), at(36.8, 181), at(36.8, -181), at(Number.NaN, -119.8), at(36.8, Number.NaN), at(Number.POSITIVE_INFINITY, -119.8), at(36.8, Number.NEGATIVE_INFINITY)]) {
      expect(jurisdictionAt(spot)).toBeNull();
    }
  });

  it("refuses a spot that is not a real coordinate even inside an area drawn past the globe's edges", () => {
    const beyond: RuleArea[] = [{ key: "ca", polygon: [[-400, -200], [400, -200], [400, 200], [-400, 200]] }];
    for (const spot of [at(90, 180), at(-90, -180), at(0, 0)]) expect(jurisdictionAt(spot, beyond)).toBe("ca");
    for (const spot of [at(91, 0), at(-91, 0), at(0, 181), at(0, -181), at(91, 181), at(Number.NaN, 0), at(0, Number.POSITIVE_INFINITY)]) {
      expect(jurisdictionAt(spot, beyond)).toBeNull();
    }
  });

  it("reads its rows most specific first, so a nested area wins only inside itself", () => {
    const valley: RuleArea = { key: "ca_sra", polygon: [[-120.5, 36.0], [-119.0, 36.0], [-119.0, 37.5], [-120.5, 37.5]] };
    const areas = [valley, { key: "ca", polygon: CALIFORNIA } as const];
    expect(jurisdictionAt(at(36.8, -119.8), areas)).toBe("ca_sra");
    expect(jurisdictionAt(at(34.05, -118.24), areas)).toBe("ca");
    expect(jurisdictionAt(at(36.8, -119.8), [...areas].reverse())).toBe("ca");
  });

  it("has California as its only row until finer areas are cleared", () => {
    expect(RULE_AREAS).toEqual([{ key: "ca", polygon: CALIFORNIA }]);
  });
});

describe("locateRules", () => {
  it("gives the key for a synthetic California point", async () => {
    expect(await locateRules(async () => at(36.8, -119.8))).toBe("ca");
  });

  it("says outside for a synthetic point outside every area", async () => {
    for (const spot of [at(39.0, -117.0), at(37.7, -123.5), at(31.0, -115.5)]) expect(await locateRules(async () => spot)).toBe("outside");
  });

  it("says refused for a spot that is not a coordinate", async () => {
    for (const spot of [at(91, -119.8), at(36.8, 181), at(36.8, Number.NaN), at(Number.POSITIVE_INFINITY, -119.8)])
      expect(await locateRules(async () => spot)).toBe("refused");
  });

  it("says refused for every refusal, a rejected ask and an ask that throws, never throwing itself", async () => {
    for (const refusal of ["denied", "unavailable", "unsupported"] as const) expect(await locateRules(async () => ({ refusal }))).toBe("refused");
    expect(await locateRules(() => Promise.reject(new Error("no fix")))).toBe("refused");
    expect(
      await locateRules(() => {
        throw new Error("no geolocation");
      }),
    ).toBe("refused");
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

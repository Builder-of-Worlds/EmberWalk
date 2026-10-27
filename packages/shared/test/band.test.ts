import { describe, expect, it } from "vitest";
import { Band } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Band", () => {
  it("round trips each of the three zones and no other", () => {
    for (const zone of ["zone_0", "zone_1", "zone_2"]) roundTrips(Band, zone);
    expect(Band.options).toEqual(["zone_0", "zone_1", "zone_2"]);
  });

  it("refuses a zone that does not exist", () => {
    for (const value of ["zone_3", "Zone_0", "zone 0", "", 0, null]) refuses(Band, value);
  });
});

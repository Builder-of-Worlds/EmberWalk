import { describe, expect, it } from "vitest";
import { FindingLabel } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("FindingLabel", () => {
  it("round trips required now and recommended and no other label", () => {
    for (const label of ["required_now", "recommended"]) roundTrips(FindingLabel, label);
    expect(FindingLabel.options).toEqual(["required_now", "recommended"]);
  });

  it("refuses any other label", () => {
    for (const value of ["required", "optional", "Recommended", "", null]) refuses(FindingLabel, value);
  });
});

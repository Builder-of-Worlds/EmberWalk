import { describe, expect, it } from "vitest";
import { Spacing } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("Spacing", () => {
  it("round trips ok, too close and not checked and no other judgment", () => {
    for (const spacing of ["ok", "too_close", "not_checked"]) roundTrips(Spacing, spacing);
    expect(Spacing.options).toEqual(["ok", "too_close", "not_checked"]);
  });

  it("refuses any other judgment", () => {
    for (const value of ["too_far", "OK", "too close", "", null]) refuses(Spacing, value);
  });
});

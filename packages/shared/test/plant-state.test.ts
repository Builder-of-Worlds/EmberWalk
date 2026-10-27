import { describe, expect, it } from "vitest";
import { PlantState } from "../src/index.ts";
import { refuses, roundTrips } from "./check.ts";

describe("PlantState", () => {
  it("round trips dead, alive and unsure and no other state", () => {
    for (const state of ["dead", "alive", "unsure"]) roundTrips(PlantState, state);
    expect(PlantState.options).toEqual(["dead", "alive", "unsure"]);
  });

  it("refuses any other state", () => {
    for (const value of ["dry", "Dead", "", null]) refuses(PlantState, value);
  });
});

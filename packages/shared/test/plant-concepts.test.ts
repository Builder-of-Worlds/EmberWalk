import { describe, expect, it } from "vitest";
import { Concept, Finding, LOOP_CONCEPTS, PLANT_CONCEPTS } from "../src/index.ts";
import { TAPPED_FINDING, refuses, roundTrips } from "./check.ts";

describe("PLANT_CONCEPTS", () => {
  it("names the five plants, each a concept a walk can find, and a finding of each may carry a plant state", () => {
    expect([...PLANT_CONCEPTS]).toEqual(["dry_brush", "tree_branch_over_roof", "shrub", "tree", "dry_grass"]);
    for (const concept of PLANT_CONCEPTS) {
      roundTrips(Concept, concept);
      roundTrips(Finding, { ...TAPPED_FINDING, concept, plantState: "dead" });
    }
  });

  it("refuses a plant state on every concept that is not a plant", () => {
    const others = LOOP_CONCEPTS.filter((c) => !(PLANT_CONCEPTS as readonly string[]).includes(c));
    expect(others.length).toBe(LOOP_CONCEPTS.length - PLANT_CONCEPTS.length);
    for (const concept of others) refuses(Finding, { ...TAPPED_FINDING, concept, plantState: "alive" });
  });
});

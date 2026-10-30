import { describe, expect, it } from "vitest";
import { Concept, Finding, SPACED_CONCEPTS } from "../src/index.ts";
import { TAPPED_FINDING, refuses, roundTrips } from "./check.ts";

describe("SPACED_CONCEPTS", () => {
  it("names shrubs and trees, each a concept a walk can find, and a finding of each may carry a spacing", () => {
    expect([...SPACED_CONCEPTS]).toEqual(["shrub", "tree"]);
    for (const concept of SPACED_CONCEPTS) {
      roundTrips(Concept, concept);
      roundTrips(Finding, { ...TAPPED_FINDING, concept, spacing: "too_close" });
    }
  });

  it("refuses a spacing on every concept that is not a shrub or a tree", () => {
    const others = Concept.options.filter((c) => !(SPACED_CONCEPTS as readonly string[]).includes(c));
    expect(others.length).toBe(Concept.options.length - SPACED_CONCEPTS.length);
    for (const concept of others) refuses(Finding, { ...TAPPED_FINDING, concept, spacing: "ok" });
  });
});

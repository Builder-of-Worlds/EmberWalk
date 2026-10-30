import { describe, expect, it } from "vitest";
import { Concept, Finding, LOOP_CONCEPTS, OBJECT_CONCEPTS, PAN_CONCEPTS, Track } from "../src/index.ts";
import { TAPPED_FINDING, id, refuses, roundTrips } from "./check.ts";

const D134_OBJECTS = ["gas_can", "stored_fuel", "lawn_mower", "grill", "propane_cylinder", "vehicle", "lumber_pile", "tarp", "doormat", "boat_or_trailer"];

const track = (concept: string) => ({ id: id(1), clipId: id(2), concept, samObjectId: 0, frames: [{ frame: 0, box: [0.1, 0.2, 0.3, 0.4], mask: "clips/w1/m0.png", confidence: 0.9 }] });

describe("the two part walk's concept lists", () => {
  it("looks for 26 concepts on the loop and 18 on the corner pans, every pan concept one a loop can find", () => {
    expect(LOOP_CONCEPTS).toHaveLength(26);
    expect(PAN_CONCEPTS).toHaveLength(18);
    const loop: readonly string[] = LOOP_CONCEPTS;
    expect(PAN_CONCEPTS.filter((concept) => !loop.includes(concept))).toEqual([]);
  });

  it("names every loop concept once, and every concept is one the loop looks for", () => {
    expect(new Set(LOOP_CONCEPTS).size).toBe(LOOP_CONCEPTS.length);
    expect([...Concept.options]).toEqual([...LOOP_CONCEPTS]);
  });
});

describe("wood decks are a hazard with their own finding", () => {
  it("looks for a wood deck on the loop, where the house is in view, and not on the pans", () => {
    roundTrips(Concept, "wood_deck");
    roundTrips(Track, track("wood_deck"));
    roundTrips(Finding, { ...TAPPED_FINDING, concept: "wood_deck" });
    const pan: readonly string[] = PAN_CONCEPTS;
    expect(LOOP_CONCEPTS).toContain("wood_deck");
    expect(pan.includes("wood_deck")).toBe(false);
  });
});

describe("the ten yard objects are concepts a track and a finding can name", () => {
  it("lists the ten objects once each, and looks for every one on the loop and on the pans", () => {
    expect([...OBJECT_CONCEPTS]).toEqual(D134_OBJECTS);
    const loop: readonly string[] = LOOP_CONCEPTS;
    const pan: readonly string[] = PAN_CONCEPTS;
    expect(OBJECT_CONCEPTS.filter((concept) => !loop.includes(concept) || !pan.includes(concept))).toEqual([]);
  });

  it.each(D134_OBJECTS)("a track and a finding of %s round trip", (concept) => {
    roundTrips(Concept, concept);
    roundTrips(Track, track(concept));
    roundTrips(Finding, { ...TAPPED_FINDING, concept });
  });

  it("refuses an object that is in no list", () => {
    refuses(Concept, "gas can");
    refuses(Concept, "deck");
    refuses(Track, track("jerry_can"));
    refuses(Finding, { ...TAPPED_FINDING, concept: "boat" });
  });
});

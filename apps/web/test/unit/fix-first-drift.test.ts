import { describe, expect, it } from "vitest";
import { fixFirstOfFound, type FoundItem } from "../../../../packages/rules/src/accuracy.ts";
import { fixFirstOf, type Label, type ResultFinding } from "../../src/results.ts";

type Spec = { id: string; low: number; high: number; label: Label; confidence: number };

const SPECS: Spec[] = [
  { id: "m", low: 5, high: 5, label: "required_now", confidence: 0.9 },
  { id: "far", low: 30, high: 30, label: "required_now", confidence: 0.9 },
  { id: "a", low: 5, high: 5, label: "recommended", confidence: 0.9 },
  { id: "c", low: 5, high: 5, label: "required_now", confidence: 0.6 },
  { id: "d", low: 5, high: 5, label: "required_now", confidence: 0.6 },
  { id: "b", low: 5, high: 9, label: "required_now", confidence: 0.9 },
  { id: "edge", low: 29.9, high: 31, label: "recommended", confidence: 0.9 },
  { id: "z", low: 2, high: 2, label: "recommended", confidence: 0.9 },
];

const appFinding = (s: Spec): ResultFinding =>
  ({ id: s.id, concept: "wood_pile", band: "zone_1", distanceFeet: { low: s.low, high: s.high }, label: s.label, confidence: s.confidence }) as ResultFinding;

const scorerFinding = (s: Spec): FoundItem => ({ id: s.id, concept: "wood_pile", side: null, feet: { low: s.low, high: s.high }, band: "zone_1", contact: null, label: s.label, confidence: s.confidence });

describe("the Fix These 3 First order in the app and in the accuracy scorer", () => {
  it("is the same list on the same findings inside 30 feet: distance, then far end, then required before recommended, then the surer first, then id", () => {
    const app = fixFirstOf(SPECS.map(appFinding), () => false).map((f) => f.id);
    const scorer = fixFirstOfFound(SPECS.map(scorerFinding));
    expect(scorer).toEqual(app);
    expect(app).toEqual(["z", "m", "c", "d", "a", "b", "edge"]);
  });

  it("gives the same list whatever order the findings come in", () => {
    const reversed = fixFirstOf([...SPECS].reverse().map(appFinding), () => false).map((f) => f.id);
    expect(reversed).toEqual(fixFirstOf(SPECS.map(appFinding), () => false).map((f) => f.id));
  });
});

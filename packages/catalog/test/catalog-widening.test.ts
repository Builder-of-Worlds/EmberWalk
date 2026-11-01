import { describe, expect, it } from "vitest";
import { RULES } from "@emberwalk/rules";
import { Concept } from "@emberwalk/shared";
import { rowsForClip } from "../src/catalog.ts";

const HOUSE_OBJECTS = [
  "gas_can",
  "stored_fuel",
  "lawn_mower",
  "grill",
  "propane_cylinder",
  "vehicle",
  "lumber_pile",
  "tarp",
  "doormat",
  "boat_or_trailer",
];

describe('detection widens to every identifiable object around a house that matters in a fire', () => {
  it.each(HOUSE_OBJECTS)("the detection production runs on a loop clip asks for %s", (object) => {
    expect(rowsForClip("loop").map((row) => row.concept)).toContain(object);
  });

  it.each(HOUSE_OBJECTS)("a walk can store a track and carry a finding for %s", (object) => {
    expect(Concept.options).toContain(object);
    const row = rowsForClip("loop").find((r) => r.concept === object);
    expect(row?.pending, `${object} is still only tallied`).toBeUndefined();
    expect(RULES.filter((r) => r.concept === object && r.key === row?.ruleKey).length, `${object} has no rule row`).toBeGreaterThan(0);
  });
});

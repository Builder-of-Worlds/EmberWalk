import { describe, expect, it } from "vitest";
import { bandFor, lookup, type Query } from "../src/index.ts";
import { query } from "./support.ts";

const citations = (q: Query, jurisdiction: Parameters<typeof lookup>[1] = "ca") => lookup(q, jurisdiction).map((r) => r.citation);

describe("bandFor", () => {
  it("puts a distance in the closest band whose far edge it reaches", () => {
    expect(bandFor({ low: 0, high: 0 })).toBe("zone_0");
    expect(bandFor({ low: 5, high: 5 })).toBe("zone_0");
    expect(bandFor({ low: 5.17, high: 5.17 })).toBe("zone_1");
    expect(bandFor({ low: 30, high: 30 })).toBe("zone_1");
    expect(bandFor({ low: 30.5, high: 40 })).toBe("zone_2");
    expect(bandFor({ low: 100, high: 100 })).toBe("zone_2");
  });

  it("puts a range that straddles an edge in the closer band", () => {
    expect(bandFor({ low: 4, high: 7 })).toBe("zone_0");
    expect(bandFor({ low: 28, high: 33 })).toBe("zone_1");
    expect(bandFor({ low: 95, high: 140 })).toBe("zone_2");
  });

  it("drops anything past 100 feet", () => {
    expect(bandFor({ low: 100.01, high: 120 })).toBeNull();
  });

  it("refuses negative, reversed and non finite distances", () => {
    for (const d of [{ low: -0.1, high: 1 }, { low: 3, high: 2 }, { low: Number.NaN, high: 1 }, { low: 1, high: Number.POSITIVE_INFINITY }]) {
      expect(() => bandFor(d)).toThrow();
    }
  });
});

describe("lookup", () => {
  it("gives a wood pile against the wall the Zone 1 rule first and the Zone 0 guidance as a note", () => {
    expect(citations(query({ concept: "wood_pile", contact: "yes" }, 0))).toEqual(["14 CCR 1299.03(a)(3)", "CAL FIRE Zone 0 guidance"]);
  });

  it("gives a covered wood pile within 5 feet only the Zone 0 guidance, and nothing from 5 to 30 feet", () => {
    expect(citations(query({ concept: "wood_pile", flags: ["covered"] }, 3))).toEqual(["CAL FIRE Zone 0 guidance"]);
    expect(citations(query({ concept: "wood_pile", flags: ["covered"] }, 12))).toEqual([]);
  });

  it("asks a wood pile past 30 feet for 10 feet of clearance unless it has it", () => {
    expect(citations(query({ concept: "wood_pile" }, 40))).toEqual(["14 CCR 1299.03(b)(2)(C)"]);
    expect(citations(query({ concept: "wood_pile", flags: ["cleared"] }, 40))).toEqual([]);
  });

  it("gives a wooden fence only guidance, touching or not, and nothing past 5 feet", () => {
    expect(lookup(query({ concept: "wooden_fence", contact: "yes" }, 0), "ca").map((r) => [r.citation, r.status])).toEqual([
      ["CAL FIRE Zone 0 guidance", "recommended"],
    ]);
    expect(citations(query({ concept: "wooden_fence" }, 4))).toEqual(["CAL FIRE Zone 0 guidance"]);
    expect(citations(query({ concept: "wooden_fence", contact: "yes" }, 6))).toEqual([]);
  });

  it("cites PRC 4291 in a State Responsibility Area, Gov. Code 51182 in a local zone, and both when not sure", () => {
    const branch = query({ concept: "tree_branch_over_roof", flags: ["near_chimney"] }, 0);
    expect(citations(branch, "ca_sra")).toEqual(["14 CCR 1299.03(a)(2)", "PRC 4291(a)(2)", "CAL FIRE Zone 0 guidance"]);
    expect(citations(branch, "ca_vhfhsz")).toEqual(["14 CCR 1299.03(a)(2)", "Gov. Code 51182(a)(2)", "CAL FIRE Zone 0 guidance"]);
    expect(citations(branch, "ca")).toEqual(["14 CCR 1299.03(a)(2)", "PRC 4291(a)(2)", "Gov. Code 51182(a)(2)", "CAL FIRE Zone 0 guidance"]);
  });

  it("refuses a jurisdiction whose rules are not loaded", () => {
    for (const j of ["or", "ca_marin", "CA", ""]) expect(() => lookup(query({ concept: "dry_brush" }), j as "ca")).toThrow();
  });

  it("counts a plant judged unsure as dead, and an unjudged plant as neither dead nor alive", () => {
    expect(citations(query({ concept: "tree", plantState: "unsure" }, 10))).toEqual(["14 CCR 1299.03(a)(1)"]);
    expect(citations(query({ concept: "tree_branch_over_roof", plantState: null }, 10))).toEqual([]);
    expect(citations(query({ concept: "tree_branch_over_roof", plantState: "alive" }, 10))).toEqual(["CAL FIRE Zone 1 guidance"]);
  });

  it("adds the statute for dry brush touching the house", () => {
    expect(citations(query({ concept: "dry_brush", contact: "yes" }, 0), "ca_sra")).toEqual([
      "14 CCR 1299.03(a)(1)",
      "PRC 4291(a)(3)",
      "CAL FIRE Zone 0 guidance",
    ]);
  });

  it("treats a vent as recommended unless debris is against it", () => {
    expect(lookup(query({ concept: "foundation_vent" }, 0), "ca").map((r) => r.status)).toEqual(["recommended", "recommended"]);
    expect(citations(query({ concept: "foundation_vent", flags: ["debris"] }, 0))[0]).toBe("14 CCR 1299.03(a)(1)");
  });

  it("asks for grass past 30 feet to be cut to 4 inches unless it already is", () => {
    expect(citations(query({ concept: "dry_grass" }, 50))).toEqual(["14 CCR 1299.03(b)(2)(B)"]);
    expect(citations(query({ concept: "dry_grass", flags: ["cut_short"] }, 50))).toEqual([]);
  });

  it("finds the chimney only with a branch near it, and the house wall only in its first 5 feet", () => {
    for (const feet of [0, 10, 50]) expect(citations(query({ concept: "chimney", contact: "yes" }, feet))).toEqual([]);
    expect(citations(query({ concept: "chimney", flags: ["near_chimney"] }, 50))).toEqual([]);
    expect(citations(query({ concept: "house_wall", contact: "yes" }, 0))).toEqual(["CAL FIRE Zone 0 guidance"]);
    for (const feet of [10, 50]) expect(citations(query({ concept: "house_wall", contact: "yes" }, feet))).toEqual([]);
  });

  it("finds nothing past 100 feet", () => {
    expect(citations(query({ concept: "propane_tank" }, 101))).toEqual([]);
  });

  it("refuses an unknown concept, a plant state on a non plant, spacing on a non tree, an unknown flag and extra fields", () => {
    const bad: unknown[] = [
      query({ concept: "pine_needles" as "shrub" }),
      query({ concept: "wood_pile", plantState: "dead" }),
      query({ concept: "dry_brush", spacing: "too_close" }),
      query({ concept: "shed", flags: ["fireproof" as "cleared"] }),
      { ...query({ concept: "shed" }), band: "zone_0" },
      { concept: "shed" },
      null,
    ];
    for (const q of bad) expect(() => lookup(q as Query, "ca")).toThrow();
  });
});

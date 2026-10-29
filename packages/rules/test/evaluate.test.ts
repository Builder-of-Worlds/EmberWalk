import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { Concept, FindingLabel, PLANT_CONCEPTS } from "@emberwalk/shared";
import { evaluate, loadState, rank, RULES, RulesRefusal, SEVERITY, UNLISTED_SEVERITY, type Observation, type RuleFinding } from "../src/index.ts";
import { CASES, ZZ } from "./support.ts";

type TruthHazard = { id: string; concept: string; distance_ft: number; band: string; contact: boolean; label: string; rule: string };
const truth = JSON.parse(readFileSync(new URL("../../../fixtures/synthetic/test-yard/truth.json", import.meta.url), "utf8")) as {
  hazards: TruthHazard[];
};
const BAND = { "0_5": "zone_0", "5_30": "zone_1", "30_100": "zone_2" } as Record<string, string>;

const seen = (o: Partial<Observation> & Pick<Observation, "id" | "concept">, feet = 2): Observation => ({
  distanceFeet: { low: feet, high: feet },
  contact: "no",
  plantState: null,
  spacing: null,
  flags: [],
  frameShare: 0.1,
  confidence: 0.8,
  ...o,
});

const fromTruth = (h: TruthHazard): Observation =>
  seen({ id: h.id, concept: Concept.parse(h.concept.replaceAll(" ", "_")), contact: h.contact ? "yes" : "no" }, h.distance_ft);

describe("evaluate and rank on the test yard truth", () => {
  it("turns the test yard truth into its three findings in fix first order", () => {
    const ranked = rank(evaluate(truth.hazards.map(fromTruth), "ca"));
    expect(ranked.map((f) => [f.rank, f.observationId, f.band, f.label, f.citations[0], f.severity, f.because])).toEqual([
      [1, "wood-pile-1", "zone_0", "required_now", "14 CCR 1299.03(a)(3)", 10, "first"],
      [2, "fence-joint-1", "zone_0", "recommended", "CAL FIRE Zone 0 guidance", 9, "severity"],
      [3, "dry-brush-1", "zone_1", "required_now", "14 CCR 1299.03(a)(1)", 7, "band"],
    ]);
    for (const h of truth.hazards) {
      const f = ranked.find((r) => r.observationId === h.id)!;
      expect([f.band, f.label, f.citations[0]], h.id).toEqual([BAND[h.band], h.label, h.rule]);
    }
  });

  it("gives the same order for the same walk in any input order", () => {
    const hazards = truth.hazards.map(fromTruth);
    const once = rank(evaluate(hazards, "ca"));
    expect(rank(evaluate([...hazards].reverse(), "ca"))).toEqual(once);
    expect(rank([...evaluate(hazards, "ca")].reverse())).toEqual(once);
  });
});

describe("evaluate and rank across states", () => {
  beforeAll(() => {
    loadState(ZZ);
  });

  it("gives the same test yard observations zz's own rules, citations, bands and wording under zz", () => {
    const ranked = rank(evaluate(truth.hazards.map(fromTruth), "zz"));
    expect(ranked.map((f) => [f.rank, f.observationId, f.band, f.label, f.ruleIds, f.citations, f.instruction])).toEqual([
      [1, "wood-pile-1", "zone_0", "required_now", ["zz-wood-alpha-z0", "zz-wood-guide-z0"], ["ZZ Made Up Code 1(a)", "ZZ Made Up Guide Part 2"], "Made up test wording: move the wood."],
      [2, "fence-joint-1", "zone_0", "recommended", ["zz-fence-guide-z0"], ["ZZ Made Up Guide Part 3"], "Made up test wording: swap the fence."],
      [3, "dry-brush-1", "zone_0", "required_now", ["zz-brush-beta-z0"], ["ZZ Made Up Code 2(b)"], "Made up test wording: cut the brush."],
    ]);
  });

  it("keeps each state's jurisdictions to their own statutes", () => {
    const found = (code: string) => evaluate(truth.hazards.map(fromTruth), code).map((f) => [f.observationId, f.ruleIds]);
    expect(found("zz_alpha")).toEqual([
      ["wood-pile-1", ["zz-wood-alpha-z0", "zz-wood-guide-z0"]],
      ["fence-joint-1", ["zz-fence-guide-z0"]],
    ]);
    expect(found("zz_beta")).toEqual([
      ["wood-pile-1", ["zz-wood-guide-z0"]],
      ["dry-brush-1", ["zz-brush-beta-z0"]],
      ["fence-joint-1", ["zz-fence-guide-z0"]],
    ]);
    expect(evaluate(truth.hazards.map(fromTruth), "ca").flatMap((f) => f.ruleIds).every((id) => id.startsWith("ca-"))).toBe(true);
  });

  it("refuses a state that is not loaded with a typed refusal, before judging any observation", () => {
    for (const code of ["nv", "zz_gamma", "ZZ"]) expect(() => evaluate(truth.hazards.map(fromTruth), code)).toThrow(RulesRefusal);
    expect(() => evaluate([], "nv")).toThrow(RulesRefusal);
  });
});

describe("evaluate", () => {
  it("names every rule that applies, in force first, with each citation once", () => {
    const [f] = evaluate([seen({ id: "b", concept: "tree_branch_over_roof", plantState: "dead", flags: ["near_chimney"] }, 0)], "ca_sra");
    expect(f!.ruleIds).toEqual([
      "ca-branch-dead-ccr-z0",
      "ca-branch-dead-prc-z0",
      "ca-branch-chimney-ccr-z0",
      "ca-branch-chimney-prc-z0",
      "ca-tree-branch-over-roof-zone-0-calfire-z0",
    ]);
    expect(f!.citations).toEqual(["14 CCR 1299.03(a)(2)", "PRC 4291(a)(3)", "PRC 4291(a)(2)", "CAL FIRE Zone 0 guidance"]);
    expect(FindingLabel.parse(f!.label)).toBe("required_now");
    expect(f!.severity).toBe(10);
  });

  it("labels a finding required now only when a rule in force applies", () => {
    const found = evaluate(
      [seen({ id: "fence", concept: "wooden_fence", contact: "yes" }, 0), seen({ id: "vent", concept: "foundation_vent", flags: ["debris"] }, 0)],
      "ca",
    );
    expect(found.map((f) => [f.observationId, f.label])).toEqual([
      ["fence", "recommended"],
      ["vent", "required_now"],
    ]);
  });

  it('chimney and wall get a rule that makes findings for them: a chimney and a wall observation each give one finding with its citation', () => {
    const found = evaluate([seen({ id: "chimney", concept: "chimney", flags: ["near_chimney"] }, 0), seen({ id: "wall", concept: "house_wall" }, 0)], "ca");
    expect(found.map((f) => [f.observationId, f.concept, f.band, f.label, f.citations])).toEqual([
      ["chimney", "chimney", "zone_0", "required_now", ["14 CCR 1299.03(a)(2)", "PRC 4291(a)(2)", "Gov. Code 51182(a)(2)"]],
      ["wall", "house_wall", "zone_0", "recommended", ["CAL FIRE Zone 0 guidance"]],
    ]);
  });

  it("drops what no rule covers: a chimney with no branch near it, things past 100 feet, a covered wood pile past 5 feet", () => {
    const found = evaluate(
      [
        seen({ id: "chimney", concept: "chimney", contact: "yes" }, 0),
        seen({ id: "far", concept: "shed" }, 120),
        seen({ id: "covered", concept: "wood_pile", flags: ["covered"] }, 12),
        seen({ id: "fine", concept: "shrub", plantState: "alive", spacing: "ok" }, 20),
      ],
      "ca",
    );
    expect(found).toEqual([]);
  });

  it("scores severity from the fixed table, with anything the table does not name below every named case", () => {
    const score = (o: Observation) => evaluate([o], "ca")[0]!.severity;
    expect(score(seen({ id: "a", concept: "wood_pile", contact: "yes" }, 0))).toBe(10);
    expect(score(seen({ id: "a", concept: "wood_pile" }, 12))).toBe(8);
    expect(score(seen({ id: "a", concept: "wooden_fence", contact: "no" }, 3))).toBe(UNLISTED_SEVERITY);
    expect(score(seen({ id: "a", concept: "tree", plantState: "unsure" }, 12))).toBe(7);
    expect(score(seen({ id: "a", concept: "shrub", plantState: "unsure" }, 12))).toBe(7);
    expect(score(seen({ id: "a", concept: "tree_branch_over_roof", plantState: "unsure" }, 0))).toBe(9);
    expect(score(seen({ id: "a", concept: "shrub", plantState: "alive", flags: ["near_window"] }, 12))).toBe(4);
    expect(score(seen({ id: "a", concept: "propane_tank", flags: ["cleared"] }, 3))).toBe(UNLISTED_SEVERITY);
    expect(score(seen({ id: "a", concept: "foundation_vent" }, 0))).toBe(3);
    expect(Math.min(...SEVERITY.map((s) => s.score))).toBeGreaterThan(UNLISTED_SEVERITY);
    expect(SEVERITY.map((s) => s.score)).toEqual([...SEVERITY.map((s) => s.score)].sort((a, b) => b - a));
  });

  it("refuses a negative distance, an unknown concept, a share or confidence outside 0 to 1, a blank or repeated id", () => {
    const bad: Observation[][] = [
      [seen({ id: "a", concept: "shed", distanceFeet: { low: -2, high: 1 } })],
      [seen({ id: "a", concept: "woodpile" as "shed" })],
      [seen({ id: "a", concept: "shed", frameShare: 1.5 })],
      [seen({ id: "a", concept: "shed", confidence: -0.1 })],
      [seen({ id: " ", concept: "shed" })],
      [seen({ id: "a", concept: "shed" }), seen({ id: "a", concept: "trash_can" })],
    ];
    for (const list of bad) expect(() => evaluate(list, "ca")).toThrow();
  });
});

describe("the instruction", () => {
  const MIDDLE = { zone_0: 2.5, zone_1: 17, zone_2: 65 } as const;
  const one = (o: Partial<Observation> & Pick<Observation, "concept">, feet: number) => evaluate([seen({ id: "p", ...o }, feet)], "ca")[0]!;

  it("never tells the owner a plant judged unsure is dead, whatever rule comes first", () => {
    const plants = RULES.filter((r) => (PLANT_CONCEPTS as readonly string[]).includes(r.concept));
    let checked = 0;
    for (const row of plants) {
      const f = evaluate([seen({ id: "p", ...CASES[row.key], concept: row.concept, plantState: "unsure" }, MIDDLE[row.zone])], "ca")[0];
      if (!f) continue;
      checked++;
      expect(f.instruction.replace(/\b(?:may|might|could) be dead\b/, ""), row.id).not.toMatch(/\bdead\b/i);
    }
    expect(checked).toBeGreaterThan(plants.length / 2);
  });

  it("says a plant judged unsure may be dead, never that it is, and says a dead one is dead", () => {
    const lead = (r: (typeof RULES)[number]) => RULES.find((x) => x.id === r.id.replace(/-(prc|gov)-/, "-ccr-"));
    const rows = RULES.filter((r) => r.when.plant?.includes("unsure") && r.unsure !== null && lead(r)?.code === "14 CCR");
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const maybe = one({ ...CASES[row.key], concept: row.concept, plantState: "unsure" }, MIDDLE[row.zone]);
      const dead = one({ ...CASES[row.key], concept: row.concept, plantState: "dead" }, MIDDLE[row.zone]);
      expect(maybe.ruleIds[0], row.id).toBe(row.id.replace(/-(prc|gov)-/, "-ccr-"));
      expect(maybe.instruction, row.id).toBe(row.unsure);
      expect(maybe.instruction, row.id).not.toMatch(/\bthe dead\b/i);
      expect(dead.instruction, row.id).toBe(row.plain.en);
    }
  });

  it("gives the plain wording of the first rule that applies, in English only", () => {
    for (const f of evaluate(truth.hazards.map(fromTruth), "ca")) {
      const first = RULES.find((r) => r.id === f.ruleIds[0])!;
      expect(f.instruction, f.observationId).toBe(first.plain.en);
    }
    expect(one({ concept: "tree", plantState: "alive", flags: ["near_chimney"] }, 3).instruction).toBe(
      "Trim back any branch that reaches within 10 feet of the chimney, using a pole saw from the ground.",
    );
  });
});

describe("a dry brush or dry grass judged alive", () => {
  const ASKED = [
    { concept: "dry_brush", feet: 65, contact: "no", dead: "A rented brush cutter clears a big patch of dead brush; rake it up and haul it away.", maybe: "Some brush out here might be dead: where stems crack and leaves are brown, cut it and haul it off." },
    { concept: "dry_brush", feet: 17, contact: "no", dead: "Cut the dry brush and haul it off, or bag it for the green waste bin.", maybe: null },
    { concept: "dry_brush", feet: 2.5, contact: "no", dead: "Cut the dry brush and haul it off, or bag it for the green waste bin.", maybe: null },
    { concept: "dry_brush", feet: 2.5, contact: "yes", dead: "Cut the dry brush and haul it off, or bag it for the green waste bin.", maybe: null },
    { concept: "dry_grass", feet: 2.5, contact: "no", dead: "Mow the dead grass short and rake up the clippings.", maybe: "Grass that stays brown after watering may be dead; mow it short and rake it up." },
    { concept: "dry_grass", feet: 17, contact: "no", dead: "Mow the dead grass short and rake up the clippings.", maybe: "Grass that stays brown after watering may be dead; mow it short and rake it up." },
  ] as const;
  const walk = (concept: "dry_brush" | "dry_grass", feet: number, contact: "yes" | "no", plantState: Observation["plantState"]) =>
    evaluate([seen({ id: "p", concept, contact, plantState }, feet)], "ca");

  it("gets no finding at all, at any distance, touching the house or not", () => {
    for (const { concept, feet, contact } of ASKED) expect(walk(concept, feet, contact, "alive"), `${concept} at ${feet} ft`).toEqual([]);
  });

  it("still gets the finding and today's wording when judged dead, and the may be dead wording when unsure", () => {
    for (const { concept, feet, contact, dead, maybe } of ASKED) {
      expect(walk(concept, feet, contact, "dead")[0]?.instruction, `${concept} at ${feet} ft dead`).toBe(dead);
      expect(walk(concept, feet, contact, "unsure")[0]?.instruction, `${concept} at ${feet} ft unsure`).toBe(maybe ?? dead);
    }
  });

  it("still gets the finding and today's wording when not judged", () => {
    for (const { concept, feet, contact, dead } of ASKED) {
      expect(walk(concept, feet, contact, null)[0]?.instruction, `${concept} at ${feet} ft not judged`).toBe(dead);
    }
  });

  it("keeps the same severity and rules whether judged dead, unsure or not judged", () => {
    for (const { concept, feet, contact } of ASKED) {
      const [dead] = walk(concept, feet, contact, "dead");
      for (const state of ["unsure", null] as const) {
        const [other] = walk(concept, feet, contact, state);
        expect([other?.severity, other?.ruleIds], `${concept} at ${feet} ft ${state}`).toEqual([dead?.severity, dead?.ruleIds]);
      }
    }
  });

  it("keeps the 4 inch grass rule for tall grass judged alive, since that rule is about height, not dead fuel", () => {
    const [found] = walk("dry_grass", 65, "no", "alive");
    expect(found?.instruction).toBe("Mow or string trim the tall grass down to 4 inches or less.");
    expect(found?.citations).toEqual(["14 CCR 1299.03(b)(2)(B)"]);
  });

  it("refuses a plant state that is not dead, alive or unsure, and alive on a thing that is not a plant", () => {
    expect(() => walk("dry_brush", 65, "no", "dying" as "dead")).toThrow();
    expect(() => evaluate([seen({ id: "p", concept: "wood_pile", plantState: "alive" })], "ca")).toThrow();
  });
});

describe("rank", () => {
  const finding =(id: string, f: Partial<RuleFinding>): RuleFinding => ({
    observationId: id,
    instruction: "Move the shed.",
    concept: "shed",
    band: "zone_1",
    ruleIds: ["ca-shed-clearance-ccr-z1"],
    citations: ["14 CCR 1299.03(c)(1)"],
    label: "required_now",
    severity: 5,
    frameShare: 0.2,
    confidence: 0.9,
    ...f,
  });

  it("orders by band, then severity, then frame share, then confidence, then id, and says which one decided", () => {
    const ranked = rank([
      finding("f", { band: "zone_2", severity: 10 }),
      finding("e", { confidence: 0.5 }),
      finding("d", {}),
      finding("c", { frameShare: 0.4 }),
      finding("b", { severity: 8 }),
      finding("a", { band: "zone_0", severity: 1 }),
      finding("g", {}),
    ]);
    expect(ranked.map((f) => [f.rank, f.observationId, f.because])).toEqual([
      [1, "a", "first"],
      [2, "b", "band"],
      [3, "c", "severity"],
      [4, "d", "frame_share"],
      [5, "g", "id"],
      [6, "e", "confidence"],
      [7, "f", "band"],
    ]);
  });

  it("ranks every Zone 2 finding below every Zone 0 and Zone 1 finding", () => {
    const ranked = rank([finding("far", { band: "zone_2", severity: 10, frameShare: 1, confidence: 1 }), finding("near", { severity: 1 })]);
    expect(ranked.map((f) => f.observationId)).toEqual(["near", "far"]);
  });

  it("gives an empty list for no findings and refuses two findings from one observation", () => {
    expect(rank([])).toEqual([]);
    expect(() => rank([finding("a", {}), finding("a", { severity: 9 })])).toThrow();
    expect(() => rank([finding("a", {}), finding("b", {}), finding("a", { band: "zone_2" })])).toThrow();
    expect(rank([finding("b", {}), finding("a", {})]).map((f) => f.observationId)).toEqual(["a", "b"]);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AccuracyInputError,
  MATCH_FEET,
  PROPOSED_BARS,
  fixFirstOfFound,
  matchItems,
  parseFindings,
  parseTruth,
  poolHouses,
  scoreHouse,
  scoreOrder,
  topThreeFromTruth,
  type ConceptScore,
  type FoundItem,
  type TruthItem,
} from "../src/accuracy.ts";

const fixture = (path: string) => JSON.parse(readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8"));

const truthItem = (id: string, concept: string, feet: number, band: TruthItem["band"], more: Partial<TruthItem> = {}): TruthItem => ({
  id,
  concept,
  side: null,
  feet,
  band,
  contact: false,
  label: "required_now",
  ...more,
});

const foundItem = (id: string, concept: string, low: number, band: FoundItem["band"], more: Partial<FoundItem> = {}): FoundItem => ({
  id,
  concept,
  side: null,
  feet: { low, high: more.feet?.high ?? low },
  band,
  contact: null,
  label: "required_now",
  ...more,
});

const TRUTH: TruthItem[] = [
  truthItem("wp1", "wood_pile", 0, "zone_0", { contact: true }),
  truthItem("wp2", "wood_pile", 20, "zone_1"),
  truthItem("wp3", "wood_pile", 60, "zone_2"),
  truthItem("sh1", "shed", 3, "zone_0"),
  truthItem("db1", "dry_brush", 2, "zone_0"),
  truthItem("fn1", "wooden_fence", 7, "zone_1", { contact: true }),
];

const FOUND: FoundItem[] = [
  foundItem("a", "wood_pile", 0, "zone_0", { contact: "yes" }),
  foundItem("b", "wood_pile", 28, "zone_2", { contact: "not_checked", feet: { low: 28, high: 30 } }),
  foundItem("c", "wood_pile", 90, "zone_2"),
  foundItem("d", "shed", 8, "zone_1"),
  foundItem("db1", "dry_brush", 50, "zone_2"),
  foundItem("fence", "wooden_fence", 7, "zone_1", { contact: "yes" }),
  foundItem("t", "tree", 40, "zone_2"),
];

const concept = (concepts: ConceptScore[], name: string): ConceptScore => concepts.find((c) => c.concept === name)!;

describe("scoring one walk against its exact truth", () => {
  const house = scoreHouse(TRUTH, FOUND, { topThree: topThreeFromTruth(TRUTH) });

  it("gives Found as the share of truth items found", () => {
    const wood = concept(house.concepts, "wood_pile");
    expect(wood.measures.found).toEqual({ count: 2, of: 3, share: 2 / 3 });
    expect(concept(house.concepts, "wooden_fence").measures.found.share).toBe(1);
    expect(house.missed).toEqual(["wp3"]);
  });

  it("gives Right as the share of findings that are real", () => {
    expect(concept(house.concepts, "wood_pile").measures.right).toEqual({ count: 2, of: 3, share: 2 / 3 });
    expect(concept(house.concepts, "tree").measures.right).toEqual({ count: 0, of: 1, share: 0 });
    expect(house.falseAlarms).toEqual(["c", "t"]);
  });

  it("gives Band right among the found items", () => {
    expect(concept(house.concepts, "wood_pile").measures.bandRight).toEqual({ count: 1, of: 2, share: 0.5 });
    expect(concept(house.concepts, "wooden_fence").measures.bandRight.share).toBe(1);
    expect(concept(house.concepts, "shed").measures.bandRight.share).toBe(0);
  });

  it("gives Too far as the share placed exactly one band farther out, and counts two bands apart separately", () => {
    expect(concept(house.concepts, "wood_pile").measures.tooFar).toEqual({ count: 1, of: 2, share: 0.5 });
    expect(concept(house.concepts, "shed").measures.tooFar.share).toBe(1);
    const brush = concept(house.concepts, "dry_brush");
    expect(brush.measures.tooFar.share).toBe(0);
    expect(brush.muchTooFar).toBe(1);
  });

  it("does not count an item placed nearer than the truth as too far", () => {
    const nearer = scoreHouse([truthItem("w", "wood_pile", 20, "zone_1")], [foundItem("x", "wood_pile", 18, "zone_0")]);
    expect(nearer.concepts[0]!.tooFar).toBe(0);
    expect(nearer.concepts[0]!.bandRight).toBe(0);
  });

  it("gives wall contact right where the truth has it, and says when the pipeline did not report it", () => {
    const wood = concept(house.concepts, "wood_pile");
    expect(wood.measures.contactRight).toEqual({ count: 1, of: 1, share: 1 });
    expect(wood.contactNotReported).toBe(1);
    expect(concept(house.concepts, "wooden_fence").measures.contactRight.share).toBe(1);
    const wrong = scoreHouse([truthItem("w", "wood_pile", 0, "zone_0", { contact: true })], [foundItem("x", "wood_pile", 0, "zone_0", { contact: "no" })]);
    expect(wrong.concepts[0]!.measures.contactRight).toEqual({ count: 0, of: 1, share: 0 });
    const noTruthContact = scoreHouse([truthItem("w", "wood_pile", 0, "zone_0", { contact: null })], [foundItem("x", "wood_pile", 0, "zone_0", { contact: "yes" })]);
    expect(noTruthContact.concepts[0]!.measures.contactRight.of).toBe(0);
  });

  it("reports a concept with no truth items as found n/a, not zero", () => {
    expect(concept(house.concepts, "tree").measures.found).toEqual({ count: 0, of: 0, share: null });
  });
});

describe("matching findings to truth items", () => {
  it("takes the id the truth already gives before position", () => {
    const matches = matchItems([truthItem("db1", "dry_brush", 2, "zone_0")], [foundItem("db1", "dry_brush", 80, "zone_2")]);
    expect(matches.map((m) => [m.truth.id, m.found.id])).toEqual([["db1", "db1"]]);
  });

  it("keeps a finding on another side from matching, and one with no side matches by distance", () => {
    const truth = [truthItem("left", "wood_pile", 5, "zone_1", { side: "left" }), truthItem("right", "wood_pile", 5, "zone_1", { side: "right" })];
    const sided = matchItems(truth, [foundItem("f", "wood_pile", 5, "zone_1", { side: "right" })]);
    expect(sided.map((m) => m.truth.id)).toEqual(["right"]);
    const unsided = matchItems([truth[0]!], [foundItem("g", "wood_pile", 5, "zone_1")]);
    expect(unsided).toHaveLength(1);
    expect(matchItems([truth[0]!], [foundItem("h", "wood_pile", 5, "zone_1", { side: "back" })])).toEqual([]);
  });

  it("lets one dry grass finding answer every dry grass truth item in its band on a side it names, as one mowing does", () => {
    const truth = [
      truthItem("left", "dry_grass", 0, "zone_0", { side: "left" }),
      truthItem("back", "dry_grass", 0, "zone_0", { side: "back" }),
      truthItem("right", "dry_grass", 0, "zone_0", { side: "right" }),
      truthItem("tall", "dry_grass", 50, "zone_2", { side: "back" }),
    ];
    const found = [foundItem("near", "dry_grass", 0, "zone_0", { feet: { low: 0, high: 3 }, sides: ["left", "back"] }), foundItem("far", "dry_grass", 40, "zone_2", { feet: { low: 40, high: 60 }, sides: ["back"] })];
    const pairs = matchItems(truth, found).map((m) => [m.truth.id, m.found.id]);
    expect(pairs.sort()).toEqual([["back", "near"], ["left", "near"], ["tall", "far"]]);
    const house = scoreHouse(truth, found);
    expect(house.falseAlarms).toEqual([]);
    expect(house.missed).toEqual(["right"]);
  });

  it("counts dry grass once per band in the truth's top three, as the app lists it, so one per-band finding can score it in order", () => {
    const truth = [
      truthItem("left", "dry_grass", 0, "zone_0", { side: "left" }),
      truthItem("back", "dry_grass", 0, "zone_0", { side: "back" }),
      truthItem("right", "dry_grass", 0, "zone_0", { side: "right" }),
      truthItem("pile", "wood_pile", 1, "zone_0"),
    ];
    expect(topThreeFromTruth(truth)).toEqual(["back", "pile"]);
    const found = [foundItem("grass", "dry_grass", 0, "zone_0", { sides: ["left", "back", "right"], confidence: 0.9 }), foundItem("p", "wood_pile", 1, "zone_0", { confidence: 0.9 })];
    expect(scoreHouse(truth, found, { topThree: topThreeFromTruth(truth) }).order).toMatchObject({ inOrder: 2, inSet: 2, of: 2 });
  });

  it("never lets a per-band dry grass finding hide a wrong band: an item with none in its band pairs with the nearest band on its side", () => {
    const truth = [truthItem("left", "dry_grass", 0, "zone_0", { side: "left" }), truthItem("back", "dry_grass", 0, "zone_0", { side: "back" })];
    const found = [foundItem("mid", "dry_grass", 8, "zone_1", { feet: { low: 8, high: 20 }, sides: ["left", "back"] })];
    const house = scoreHouse(truth, found);
    expect(house.missed).toEqual([]);
    expect(house.findings).toBe(1);
    const grass = house.concepts.find((c) => c.concept === "dry_grass")!;
    expect(grass.matched).toBe(2);
    expect(grass.bandRight).toBe(0);
    expect(grass.zoneZeroFarther).toBe(2);
    expect(grass.measures.right.share).toBe(1);
  });

  it("pairs one finding with one truth item, the nearest first, and leaves the other a false alarm", () => {
    const house = scoreHouse([truthItem("t", "wood_pile", 10, "zone_1")], [foundItem("far", "wood_pile", 14, "zone_1"), foundItem("near", "wood_pile", 11, "zone_1")]);
    expect(house.placements.map((p) => p.finding)).toEqual(["near"]);
    expect(house.falseAlarms).toEqual(["far"]);
  });

  it("uses one finding for one truth item only, when two items of one concept both lie within 10 feet of it", () => {
    const truth = [truthItem("t1", "wood_pile", 10, "zone_1"), truthItem("t2", "wood_pile", 14, "zone_1")];
    const found = [foundItem("only", "wood_pile", 12, "zone_1")];
    const matches = matchItems(truth, found);
    expect(matches).toHaveLength(1);
    const house = scoreHouse(truth, found);
    expect(house.placements).toHaveLength(1);
    expect(house.missed).toHaveLength(1);
    expect(house.concepts[0]!.measures.found).toEqual({ count: 1, of: 2, share: 0.5 });
    expect(house.falseAlarms).toEqual([]);
  });

  it("matches a finding exactly 10 feet from its truth item and not one at 10.1 feet", () => {
    const truth = [truthItem("t", "wood_pile", 20, "zone_1")];
    expect(MATCH_FEET).toBe(10);
    expect(matchItems(truth, [foundItem("far-out", "wood_pile", 30, "zone_2")])).toHaveLength(1);
    expect(matchItems(truth, [foundItem("far-out", "wood_pile", 30.1, "zone_2")])).toEqual([]);
    expect(matchItems(truth, [foundItem("near-in", "wood_pile", 10, "zone_1")])).toHaveLength(1);
    expect(matchItems(truth, [foundItem("near-in", "wood_pile", 9.9, "zone_1")])).toEqual([]);
  });

  it("lets an equal id lift only the 10 foot cutoff, so concept and side must still agree", () => {
    expect(matchItems([truthItem("same", "wood_pile", 2, "zone_0")], [foundItem("same", "wood_pile", 80, "zone_2")])).toHaveLength(1);
    expect(matchItems([truthItem("same", "wood_pile", 2, "zone_0")], [foundItem("same", "shed", 2, "zone_0")])).toEqual([]);
    expect(matchItems([truthItem("same", "wood_pile", 2, "zone_0", { side: "left" })], [foundItem("same", "wood_pile", 2, "zone_0", { side: "right" })])).toEqual([]);
    expect(matchItems([truthItem("same", "wood_pile", 2, "zone_0", { side: "left" })], [foundItem("same", "wood_pile", 80, "zone_2", { side: "left" })])).toHaveLength(1);
  });

  it("does not match a finding of another concept or one far from the item", () => {
    expect(matchItems([truthItem("t", "wood_pile", 10, "zone_1")], [foundItem("s", "shed", 10, "zone_1")])).toEqual([]);
    expect(matchItems([truthItem("t", "wood_pile", 10, "zone_1")], [foundItem("w", "wood_pile", 60, "zone_2")])).toEqual([]);
  });

  it("treats a range that holds the truth distance as on it", () => {
    const matches = matchItems([truthItem("t", "wood_pile", 12, "zone_1")], [foundItem("w", "wood_pile", 4, "zone_1", { feet: { low: 4, high: 14 } })]);
    expect(matches).toHaveLength(1);
  });
});

describe("the Fix These 3 First order", () => {
  const house = scoreHouse(TRUTH, FOUND, { topThree: topThreeFromTruth(TRUTH) });

  it("derives the top three from the truth by distance inside 30 feet", () => {
    expect(topThreeFromTruth(TRUTH)).toEqual(["wp1", "db1", "sh1"]);
  });

  it("puts required items before recommended ones at the same distance, then orders by id", () => {
    const items = [
      truthItem("b", "wood_pile", 0, "zone_0", { label: "recommended" }),
      truthItem("z", "wood_pile", 0, "zone_0", { label: "required_now" }),
      truthItem("a", "shed", 0, "zone_0", { label: "required_now" }),
      truthItem("c", "shed", 0, "zone_0", { label: null }),
    ];
    expect(topThreeFromTruth(items)).toEqual(["a", "z", "b"]);
  });

  it("leaves out anything at 30 feet or farther", () => {
    const items = [truthItem("out", "shed", 30, "zone_2"), truthItem("in", "shed", 29.9, "zone_1")];
    expect(topThreeFromTruth(items)).toEqual(["in"]);
    expect(fixFirstOfFound([foundItem("far", "shed", 30, "zone_2"), foundItem("near", "shed", 29, "zone_1")])).toEqual(["near"]);
  });

  it("reports matches in order and in set against the given top three", () => {
    expect(house.order).toEqual({ given: ["wp1", "db1", "sh1"], walk: ["wp1", "fn1", "sh1"], inOrder: 2, inSet: 2, of: 3 });
  });

  it("separates in set from in order", () => {
    expect(scoreOrder(["a", "b", "c"], ["a", "c", "b"])).toMatchObject({ inOrder: 1, inSet: 3, of: 3 });
    expect(scoreOrder(["a", "b", "c"], ["c", "a", "b"])).toMatchObject({ inOrder: 0, inSet: 3 });
    expect(scoreOrder(["a", "b", "c"], [null, "a", "x"])).toMatchObject({ inOrder: 0, inSet: 1 });
  });

  it("looks only at the first three of each list", () => {
    const order = scoreOrder(["a", "b", "c", "d"], ["a", "b", "c", "d"]);
    expect(order).toMatchObject({ inOrder: 3, inSet: 3, of: 3 });
    expect(scoreOrder(["a", "b", "c"], ["x", "y", "z", "a"]).inSet).toBe(0);
  });

  it("is absent when no top three is given, and empty lists score zero of zero", () => {
    expect(scoreHouse(TRUTH, FOUND).order).toBeNull();
    expect(scoreOrder([], [])).toMatchObject({ inOrder: 0, inSet: 0, of: 0 });
    expect(scoreHouse(TRUTH, [], { topThree: ["wp1"] }).order).toMatchObject({ inOrder: 0, inSet: 0, of: 1 });
  });
});

describe("the proposed demo bars", () => {
  const woodPiles = (count: number) => Array.from({ length: count }, (_, i) => truthItem(`t${i}`, "wood_pile", i * 20, i === 0 ? "zone_0" : "zone_1"));
  const exact = (n: number, extra = 0) => [
    ...woodPiles(n).map((t) => foundItem(`f${t.id}`, "wood_pile", t.feet, t.band)),
    ...Array.from({ length: extra }, (_, i) => foundItem(`x${i}`, "wood_pile", 500 + i * 20, "zone_2")),
  ];

  it("are read from one value: found and right at least 80%, no Zone 0 item farther out", () => {
    expect(PROPOSED_BARS).toEqual({ found: 0.8, right: 0.8, zoneZeroFarther: 0 });
  });

  it("meets the bar at exactly 80% found and is below it under that", () => {
    expect(scoreHouse(woodPiles(5), exact(5).slice(0, 4)).concepts[0]!.marks).toEqual({ found: true, right: true, zoneZero: true, meets: true });
    const three = scoreHouse(woodPiles(5), exact(5).slice(0, 3)).concepts[0]!;
    expect(three.marks).toMatchObject({ found: false, right: true, meets: false });
    expect(three.measures.found.share).toBe(0.6);
  });

  it("meets the bar at exactly 80% right and is below it under that", () => {
    expect(scoreHouse(woodPiles(4), exact(4, 1)).concepts[0]!.marks).toMatchObject({ right: true, meets: true });
    const two = scoreHouse(woodPiles(4), exact(4, 2)).concepts[0]!;
    expect(two.marks).toMatchObject({ found: true, right: false, meets: false });
  });

  it("fails a concept that placed a Zone 0 item farther out even when found and right are perfect", () => {
    const shed = scoreHouse([truthItem("s", "shed", 3, "zone_0")], [foundItem("f", "shed", 8, "zone_1")]).concepts[0]!;
    expect(shed.marks).toEqual({ found: true, right: true, zoneZero: false, meets: false });
  });

  it("does not hold a Zone 1 item placed farther out to the Zone 0 bar", () => {
    const fence = scoreHouse([truthItem("f", "wooden_fence", 20, "zone_1")], [foundItem("g", "wooden_fence", 28, "zone_2")]).concepts[0]!;
    expect(fence.marks.zoneZero).toBe(true);
  });

  it("takes other bars when given them, and lists a concept below the bar as not checked", () => {
    const strict = scoreHouse(woodPiles(5), exact(5).slice(0, 4), { bars: { found: 0.9, right: 0.8, zoneZeroFarther: 0 } });
    expect(strict.notChecked).toEqual(["wood_pile"]);
    const lenient = scoreHouse([truthItem("s", "shed", 3, "zone_0")], [foundItem("f", "shed", 8, "zone_1")], { bars: { ...PROPOSED_BARS, zoneZeroFarther: 1 } });
    expect(lenient.notChecked).toEqual([]);
  });

  it("lists every concept below the bar as not checked and none that meets it", () => {
    const house = scoreHouse(TRUTH, FOUND);
    expect(house.notChecked).toEqual(["dry_brush", "shed", "tree", "wood_pile"]);
    expect(house.concepts.filter((c) => c.marks.meets).map((c) => c.concept)).toEqual(["wooden_fence"]);
  });

  it("never marks a concept it could not measure as meeting the bar", () => {
    const unmeasured = scoreHouse([], [foundItem("f", "tree", 5, "zone_1")]);
    expect(unmeasured.concepts[0]!.marks).toMatchObject({ found: false, right: false, meets: false });
  });
});

describe("an empty walk", () => {
  it("scores every truth concept found 0 and right n/a, and lists them all as not checked", () => {
    const house = scoreHouse(TRUTH, []);
    expect(house.findings).toBe(0);
    expect(house.concepts.map((c) => [c.concept, c.measures.found.share, c.measures.right.share])).toEqual([
      ["dry_brush", 0, null],
      ["shed", 0, null],
      ["wood_pile", 0, null],
      ["wooden_fence", 0, null],
    ]);
    expect(house.notChecked).toHaveLength(4);
    expect(house.missed).toEqual(["wp1", "wp2", "wp3", "sh1", "db1", "fn1"]);
  });

  it("scores nothing for a walk with no truth and no findings", () => {
    expect(scoreHouse([], [])).toMatchObject({ truthItems: 0, findings: 0, concepts: [], notChecked: [] });
  });
});

describe("pooling houses", () => {
  it("adds the counts, then takes the shares", () => {
    const one = scoreHouse([truthItem("a", "wood_pile", 0, "zone_0")], [foundItem("x", "wood_pile", 0, "zone_0")], { topThree: ["a"] });
    const two = scoreHouse([truthItem("b", "wood_pile", 0, "zone_0"), truthItem("c", "wood_pile", 30, "zone_2")], [], { topThree: ["b"] });
    const pooled = poolHouses([one, two]);
    expect(pooled.houses).toBe(2);
    expect(pooled.concepts[0]!.measures.found).toEqual({ count: 1, of: 3, share: 1 / 3 });
    expect(pooled.concepts[0]!.measures.bandRight).toEqual({ count: 1, of: 1, share: 1 });
    expect(pooled.order).toEqual({ inOrder: 1, inSet: 1, of: 2 });
    expect(pooled.notChecked).toEqual(["wood_pile"]);
  });

  it("carries the Zone 0 count across houses", () => {
    const farther = scoreHouse([truthItem("s", "shed", 3, "zone_0")], [foundItem("f", "shed", 8, "zone_1")]);
    const fine = scoreHouse([truthItem("s", "shed", 3, "zone_0")], [foundItem("f", "shed", 3, "zone_0")]);
    expect(poolHouses([fine, farther]).concepts[0]).toMatchObject({ zoneZeroFarther: 1, marks: { zoneZero: false } });
  });

  it("has no order when no house was given a top three", () => {
    expect(poolHouses([scoreHouse(TRUTH, FOUND)]).order).toBeNull();
    expect(poolHouses([])).toMatchObject({ houses: 0, concepts: [], order: null });
  });
});

describe("reading the truth files", () => {
  it("reads both truth schemas", () => {
    const yard = parseTruth(fixture("fixtures/synthetic/test-yard/truth.json"));
    expect(yard.map((t) => [t.id, t.concept, t.band, t.contact])).toEqual([
      ["wood-pile-1", "wood_pile", "zone_0", true],
      ["dry-brush-1", "dry_brush", "zone_1", false],
      ["fence-joint-1", "wooden_fence", "zone_0", true],
    ]);
    const hero = parseTruth(fixture("fixtures/synthetic/hero-before/truth.json"));
    expect(hero).toHaveLength(15);
    expect(hero.find((t) => t.id === "tall-grass-back")).toMatchObject({ concept: "dry_grass", side: "back", band: "zone_2", feet: 50 });
  });

  it("refuses a missing, empty or unlabelled truth file", () => {
    const good = fixture("fixtures/synthetic/test-yard/truth.json");
    expect(() => parseTruth(undefined)).toThrow(AccuracyInputError);
    expect(() => parseTruth({ ...good, hazards: [] })).toThrow(/truth file is malformed/);
    expect(() => parseTruth({ ...good, synthetic: false })).toThrow(AccuracyInputError);
    expect(() => parseTruth({ ...good, schema: "other/1" })).toThrow(AccuracyInputError);
  });

  it("refuses a hazard with a bad band, a negative distance or a repeated id", () => {
    const good = fixture("fixtures/synthetic/test-yard/truth.json");
    const first = good.hazards[0];
    expect(() => parseTruth({ ...good, hazards: [{ ...first, band: "0_10" }] })).toThrow(AccuracyInputError);
    expect(() => parseTruth({ ...good, hazards: [{ ...first, distance_ft: -1 }] })).toThrow(AccuracyInputError);
    expect(() => parseTruth({ ...good, hazards: [first, first] })).toThrow(/twice/);
  });
});

describe("reading findings", () => {
  const one = { id: "f", concept: "wood pile", band: "zone_0", distanceFeet: { low: 0, high: 2 } };

  it("reads a recorded set of findings or a bare list, and an empty list", () => {
    const sample = parseFindings(fixture("apps/web/src/samples/test-yard.json"));
    expect(sample).toHaveLength(1);
    expect(sample[0]).toMatchObject({ id: "wood-pile-1", concept: "wood_pile", band: "zone_0" });
    expect(parseFindings([one])[0]).toMatchObject({ concept: "wood_pile", feet: { low: 0, high: 2 }, contact: null });
    expect(parseFindings([])).toEqual([]);
    expect(parseFindings({ findings: [] })).toEqual([]);
  });

  it("refuses input that is not findings", () => {
    expect(() => parseFindings(undefined)).toThrow(AccuracyInputError);
    expect(() => parseFindings("findings")).toThrow(AccuracyInputError);
    expect(() => parseFindings({ results: [] })).toThrow(AccuracyInputError);
    expect(() => parseFindings([{ ...one, band: "zone_9" }])).toThrow(AccuracyInputError);
    expect(() => parseFindings([{ ...one, distanceFeet: { low: 5, high: 1 } }])).toThrow(/malformed/);
    expect(() => parseFindings([{ ...one, id: "" }])).toThrow(AccuracyInputError);
    expect(() => parseFindings([one, one])).toThrow(/twice/);
  });
});

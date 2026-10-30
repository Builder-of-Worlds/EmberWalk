import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compareFindings, evaluate, iou, scoreHazard, scoreWalk, type HazardRecord, type Observation, type RuleFinding } from "../src/index.ts";

const json = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), "utf8"));
const record = json("./fixtures/test-yard-sam-017.json");
const baseline = json("./fixtures/baseline-017.json");
const truth = json("../../../fixtures/synthetic/test-yard/truth.json") as {
  hazards: { id: string; concept: string; distance_ft: number; contact: boolean }[];
};

const observe = (ids: string[]): Observation[] =>
  truth.hazards
    .filter((h) => ids.includes(h.id))
    .map((h) => ({
      id: h.id,
      concept: h.concept.replaceAll(" ", "_") as Observation["concept"],
      distanceFeet: { low: h.distance_ft, high: h.distance_ft },
      contact: h.contact ? "yes" : "no",
      plantState: null,
      spacing: null,
      flags: [],
      frameShare: 0.1,
      confidence: 0.9,
    }));

const hazard = (h: Partial<HazardRecord>): HazardRecord => ({
  id: "h",
  concept: "wood_pile",
  window: [1, 2, 3, 4],
  truth: { "1": [0, 0, 100, 100], "2": [0, 0, 100, 100], "3": [0, 0, 100, 100], "4": [0, 0, 100, 100] },
  found: [],
  ...h,
});

describe("the scorer on the recorded live SAM answers of run 017", () => {
  it("reproduces the first baseline per hazard: wood pile 21 of 21, dry brush 0 of 8, fence 0 of 10", () => {
    expect(scoreWalk(record)).toEqual(baseline.hazards);
    expect(scoreWalk(record).map((s) => `${s.id} ${s.hits}/${s.window}`)).toEqual([
      "wood-pile-1 21/21",
      "dry-brush-1 0/8",
      "fence-joint-1 0/10",
    ]);
  });

  it("turns what SAM found into findings and compares them with the findings the truth gives", () => {
    const all = truth.hazards.map((h) => h.id);
    const expected = evaluate(observe(all), "ca");
    const found = evaluate(observe(scoreWalk(record).filter((s) => s.found).map((s) => s.id)), "ca");
    expect(compareFindings(expected, found)).toEqual(baseline.findings);
  });
});

describe("scoreHazard", () => {
  it("counts a window frame as a hit only when a box overlaps the truth at IoU 0.5 or more", () => {
    const s = scoreHazard(
      hazard({
        found: [
          { frame: 1, boxes: [[0, 0, 100, 100]] },
          { frame: 2, boxes: [[0, 0, 100, 50]] },
          { frame: 3, boxes: [[0, 0, 100, 49]] },
          { frame: 4, boxes: [[500, 500, 600, 600], [0, 0, 90, 90]] },
        ],
      }),
    );
    expect(s).toEqual({ id: "h", concept: "wood_pile", window: 4, hits: 3, misses: 1, falseAlarms: 1, found: true });
  });

  it("calls a hazard found on half its window and not on fewer", () => {
    const on = (frames: number[]) => frames.map((frame) => ({ frame, boxes: [[0, 0, 100, 100] as [number, number, number, number]] }));
    expect(scoreHazard(hazard({ found: on([1, 2]) })).found).toBe(true);
    expect(scoreHazard(hazard({ found: on([1]) })).found).toBe(false);
    expect(scoreHazard(hazard({ window: [1, 2, 3], found: on([1, 2]) })).found).toBe(true);
    expect(scoreHazard(hazard({ window: [1, 2, 3], found: on([1]) })).found).toBe(false);
    expect(scoreHazard(hazard({ window: [], truth: {}, found: [] })).found).toBe(false);
  });

  it("counts a box on a frame where the hazard is out of view as a false alarm, and a box on the hazard outside its window as neither", () => {
    const s = scoreHazard(
      hazard({
        truth: { ...hazard({}).truth, "9": [0, 0, 100, 100] },
        found: [
          { frame: 7, boxes: [[0, 0, 100, 100]] },
          { frame: 9, boxes: [[0, 0, 100, 100]] },
        ],
      }),
    );
    expect([s.hits, s.misses, s.falseAlarms]).toEqual([0, 4, 1]);
  });

  it("refuses a malformed box, a negative frame, an empty box list and an unknown concept", () => {
    const bad: HazardRecord[] = [
      hazard({ found: [{ frame: 1, boxes: [[50, 0, 40, 10]] }] }),
      hazard({ found: [{ frame: -1, boxes: [[0, 0, 10, 10]] }] }),
      hazard({ found: [{ frame: 1, boxes: [] }] }),
      hazard({ truth: { "1": [0, 0, 0, 10] } }),
      hazard({ truth: { "1": [0, 10, 10, 10] } }),
      hazard({ concept: "dry brush" as "dry_brush" }),
      hazard({ found: [{ frame: 1, boxes: [[0, 0, 100, 100]] }, { frame: 1, boxes: [[500, 500, 600, 600]] }] }),
      hazard({ window: [1, 1, 2] }),
    ];
    for (const h of bad) expect(() => scoreHazard(h)).toThrow();
  });
});

describe("scoreWalk", () => {
  it("refuses an empty walk and two hazards with one id", () => {
    expect(() => scoreWalk({ hazards: [] })).toThrow();
    expect(() => scoreWalk({ hazards: [hazard({}), hazard({})] })).toThrow();
  });

  it("takes one hazard and 100, and refuses 101", () => {
    const hazards = (n: number) => Array.from({ length: n }, (_, i) => hazard({ id: `h${i}` }));
    expect(scoreWalk({ hazards: hazards(1) })).toHaveLength(1);
    expect(scoreWalk({ hazards: hazards(100) })).toHaveLength(100);
    expect(() => scoreWalk({ hazards: hazards(101) })).toThrow();
  });
});

describe("the limits of a hazard record", () => {
  const frames = (n: number) => Array.from({ length: n }, (_, i) => i);
  const box = (): [number, number, number, number] => [0, 0, 10, 10];

  it("takes an id of 1 to 100 characters and refuses an empty or longer one", () => {
    expect(scoreHazard(hazard({ id: "a" })).id).toBe("a");
    expect(scoreHazard(hazard({ id: "a".repeat(100) })).id).toHaveLength(100);
    expect(() => scoreHazard(hazard({ id: "" }))).toThrow();
    expect(() => scoreHazard(hazard({ id: "a".repeat(101) }))).toThrow();
  });

  it("takes a window of 10000 frames and refuses 10001", () => {
    expect(scoreHazard(hazard({ window: frames(10_000), truth: {} })).window).toBe(10_000);
    expect(() => scoreHazard(hazard({ window: frames(10_001), truth: {} }))).toThrow();
  });

  it("takes 10000 frames with boxes and refuses 10001", () => {
    const found = (n: number) => frames(n).map((frame) => ({ frame, boxes: [box()] }));
    expect(scoreHazard(hazard({ window: [], truth: {}, found: found(10_000) })).falseAlarms).toBe(10_000);
    expect(() => scoreHazard(hazard({ window: [], truth: {}, found: found(10_001) }))).toThrow();
  });

  it("takes 16 boxes on a frame and refuses 17", () => {
    const boxes = (n: number) => Array.from({ length: n }, box);
    expect(scoreHazard(hazard({ found: [{ frame: 1, boxes: boxes(16) }] })).falseAlarms).toBe(1);
    expect(() => scoreHazard(hazard({ found: [{ frame: 1, boxes: boxes(17) }] }))).toThrow();
  });

  it("calls a one frame window found when its box hits", () => {
    const s = scoreHazard(hazard({ window: [1], found: [{ frame: 1, boxes: [[0, 0, 100, 100]] }] }));
    expect([s.hits, s.found]).toEqual([1, true]);
  });
});

describe("iou", () => {
  it("is 1 for the same box, 0 for boxes apart, and the overlap share otherwise", () => {
    expect(iou([0, 0, 10, 10], [0, 0, 10, 10])).toBe(1);
    expect(iou([0, 0, 10, 10], [20, 20, 30, 30])).toBe(0);
    expect(iou([0, 0, 10, 10], [5, 0, 15, 10])).toBeCloseTo(1 / 3);
  });

  it("measures boxes away from the top left corner the same way, side by side or one above the other", () => {
    expect(iou([10, 10, 20, 20], [15, 10, 25, 20])).toBeCloseTo(1 / 3);
    expect(iou([10, 10, 20, 20], [10, 15, 20, 25])).toBeCloseTo(1 / 3);
    expect(iou([10, 10, 20, 20], [30, 30, 40, 40])).toBe(0);
  });

  it("is 0 for boxes apart along one side only", () => {
    expect(iou([0, 0, 10, 10], [20, 0, 30, 10])).toBe(0);
    expect(iou([0, 0, 10, 10], [0, 20, 10, 30])).toBe(0);
  });
});

describe("compareFindings", () => {
  const f = (id: string, more: Partial<RuleFinding> = {}): RuleFinding => ({
    observationId: id,
    instruction: "Move the shed.",
    concept: "shed",
    band: "zone_1",
    ruleIds: ["ca-shed-clearance-ccr-z1"],
    citations: ["14 CCR 1299.03(c)(1)"],
    label: "required_now",
    severity: 5,
    frameShare: 0.1,
    confidence: 0.9,
    ...more,
  });

  it("sorts findings into hits, misses, false alarms and ones with the wrong band, label or rule", () => {
    const expected = [f("a"), f("b"), f("c"), f("d"), f("e")];
    const got = [
      f("a", { severity: 9 }),
      f("c", { band: "zone_2" }),
      f("d", { label: "recommended" }),
      f("e", { ruleIds: ["ca-shed-zone-0-calfire-z1"] }),
      f("x"),
    ];
    expect(compareFindings(expected, got)).toEqual({ hits: ["a"], misses: ["b"], falseAlarms: ["x"], wrong: ["c", "d", "e"] });
  });
});

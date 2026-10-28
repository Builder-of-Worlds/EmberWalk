import { GAP_KINDS, HINTS_FOR, SIDES } from "@emberwalk/shared";
import { describe, expect, it } from "vitest";
import { copy, longDate } from "../../src/copy.ts";
import { bandsOf, blocksGreen, dayOf, FIX_FIRST_FEET, FIX_FIRST_MOST, fixFirstOf, fixOrder, overAYearOld, sidesToWalk, verdictOf, withoutRemoved } from "../../src/results.ts";
import type { Gap, ResultFinding, Side, WalkResults } from "../../src/results.ts";
import { feet, finding, walk } from "./result-fakes.ts";
import { SETTLED_GAPS, SETTLED_SIDE } from "./settled.ts";

describe("verdictOf", () => {
  it("is incomplete whenever the video has a gap, whatever was found", () => {
    const gap: Gap = { side: "back", kind: "missing", hint: "walk_side" };
    expect(verdictOf(walk([], [gap]))).toEqual({ kind: "incomplete", gaps: [gap] });
    expect(verdictOf(walk([finding("a")], [gap])).kind).toBe("incomplete");
    expect(verdictOf(walk([], [gap]), () => true).kind).toBe("incomplete");
  });

  it("lets every gap block green on its own", () => {
    for (const side of ["front", "right", "back", "left"] as const)
      for (const kind of GAP_KINDS)
        expect(verdictOf(walk([], [{ side, kind, hint: HINTS_FOR[kind][0]! }])).kind, `${side} ${kind}`).toBe("incomplete");
  });

  it("is ready only with no gap and nothing blocking", () => {
    expect(verdictOf(walk([]))).toEqual({ kind: "ready" });
    expect(verdictOf(walk([finding("far", { label: "recommended", band: "zone_2", ...feet(40) })]))).toEqual({ kind: "ready" });
    expect(verdictOf(walk([finding("a")])).kind).toBe("fix");
  });

  it("lists the nearest open findings under 30 feet first, whatever their label, cut at the most it shows", () => {
    const list = [
      finding("req-far", feet(25, 28)),
      finding("rec-near", { label: "recommended", band: "zone_0", ...feet(3, 4) }),
      finding("rec-mid", { label: "recommended", ...feet(12, 19) }),
      finding("req-mid", feet(8, 12)),
    ];
    const verdict = verdictOf(walk(list));
    expect(verdict.kind === "fix" && verdict.first.map((f) => f.id)).toEqual(["rec-near", "req-mid", "rec-mid", "req-far"].slice(0, FIX_FIRST_MOST));
    const two = verdictOf(walk(list.slice(0, 2)));
    expect(two.kind === "fix" && two.first.map((f) => f.id)).toEqual(["rec-near", "req-far"]);
  });

  it("keeps a walk with only Recommended findings past five feet ready, with no list", () => {
    expect(verdictOf(walk([finding("rec", { label: "recommended", ...feet(10) })]))).toEqual({ kind: "ready" });
  });

  it("lists what blocks green by distance when nothing open is under 30 feet", () => {
    const list = [finding("req-60", { band: "zone_2", ...feet(60) }), finding("req-40", { band: "zone_2", ...feet(40) })];
    expect(verdictOf(walk(list))).toMatchObject({ kind: "fix", first: [{ id: "req-40" }, { id: "req-60" }] });
    const rec = finding("rec-50", { label: "recommended", band: "zone_2", ...feet(50) });
    expect(verdictOf(walk([rec, list[0]!]))).toMatchObject({ kind: "fix", first: [{ id: "req-60" }] });
  });

  it("leaves cleared items out of what blocks green", () => {
    const a = finding("a");
    expect(verdictOf(walk([a]), (f) => f.id === "a")).toEqual({ kind: "ready" });
    expect(verdictOf(walk([a, finding("b")]), (f) => f.id === "a")).toMatchObject({ kind: "fix", first: [{ id: "b" }] });
  });

  it("is never ready while coverage is not checked, or when a kept copy has no coverage at all", () => {
    const far = finding("far", { label: "recommended", band: "zone_2", ...feet(40) });
    expect(verdictOf(walk([], [], { coverage: "not_checked" }))).toEqual({ kind: "so_far" });
    expect(verdictOf(walk([far], [], { coverage: "not_checked" }))).toEqual({ kind: "so_far" });
    expect(verdictOf(walk([finding("a")], [], { coverage: "not_checked" }), (f) => f.id === "a")).toEqual({ kind: "so_far" });
    const unmarked: Partial<WalkResults> = walk([far]);
    delete unmarked.coverage;
    expect(verdictOf(unmarked as WalkResults)).toEqual({ kind: "so_far" });
  });

  it("still puts a Required Now item first while coverage is not checked", () => {
    const verdict = verdictOf(walk([finding("req"), finding("far", { label: "recommended", band: "zone_2", ...feet(40) })], [], { coverage: "not_checked" }));
    expect(verdict).toMatchObject({ kind: "fix", first: [{ id: "req" }] });
  });
});

describe("fixFirstOf", () => {
  const ids = (list: ResultFinding[]) => list.map((f) => f.id);

  it("orders findings at 2, 4, 12 and 28 feet by distance whatever their labels", () => {
    const list = [
      finding("at-12", feet(12, 14)),
      finding("at-28", { label: "recommended", ...feet(28, 40) }),
      finding("at-2", { label: "recommended", band: "zone_0", ...feet(2, 3) }),
      finding("at-4", feet(4, 6)),
    ];
    expect(ids(fixFirstOf(list, () => false))).toEqual(["at-2", "at-4", "at-12", "at-28"]);
  });

  it("puts a Recommended finding at 3 feet above a Required Now one at 25 feet", () => {
    const list = [finding("req-25", feet(25)), finding("rec-3", { label: "recommended", band: "zone_0", ...feet(3) })];
    expect(ids(fixFirstOf(list, () => false))).toEqual(["rec-3", "req-25"]);
  });

  it("never lists a finding whose near edge is 30 feet or more", () => {
    const list = [finding("at-30", feet(30, 31)), finding("at-45", { band: "zone_2", ...feet(45) }), finding("under", feet(29.9, 60))];
    expect(FIX_FIRST_FEET).toBe(30);
    expect(ids(fixFirstOf(list, () => false))).toEqual(["under"]);
  });

  it("orders equal ranges by the far edge, then Required Now before Recommended, then id", () => {
    const list = [
      finding("b-rec", { label: "recommended", ...feet(6, 9) }),
      finding("b-req", feet(6, 9)),
      finding("a-req", feet(6, 9)),
      finding("near-far", feet(6, 20)),
    ];
    expect(ids(fixFirstOf(list, () => false))).toEqual(["a-req", "b-req", "b-rec", "near-far"]);
  });

  it("drops a rechecked finding, and one removed by you never reaches it", () => {
    const list = [finding("a", feet(2)), finding("b", feet(3)), finding("c", feet(4))];
    expect(ids(fixFirstOf(list, (f) => f.id === "b"))).toEqual(["a", "c"]);
    expect(ids(fixFirstOf(withoutRemoved(walk(list), [{ findingId: "a", atMs: 1 }]).findings, () => false))).toEqual(["b", "c"]);
  });
});

describe("blocksGreen", () => {
  it("blocks for every Required Now item and every item in the first five feet", () => {
    expect(blocksGreen(finding("a", { label: "required_now", band: "zone_2" }))).toBe(true);
    expect(blocksGreen(finding("a", { label: "recommended", band: "zone_0" }))).toBe(true);
    expect(blocksGreen(finding("a", { label: "recommended", band: "zone_1" }))).toBe(false);
    expect(blocksGreen(finding("a", { label: "recommended", band: "zone_2" }))).toBe(false);
  });
});

describe("fixOrder", () => {
  it("sorts Required Now first, then by distance, then by id", () => {
    const list = [
      finding("d", { label: "recommended", ...feet(0) }),
      finding("c", feet(9, 12)),
      finding("b", feet(9, 10)),
      finding("a", feet(9, 10)),
      finding("e", feet(2)),
    ];
    expect([...list].sort(fixOrder).map((f) => f.id)).toEqual(["e", "a", "b", "c", "d"]);
  });
});

describe("bandsOf", () => {
  it("groups by band nearest first, sorts each band, and leaves out empty bands", () => {
    const list = [
      finding("far", { band: "zone_2", ...feet(50) }),
      finding("rec", { band: "zone_0", label: "recommended", ...feet(1) }),
      finding("req", { band: "zone_0", ...feet(3) }),
    ];
    expect(bandsOf(list).map((b) => [b.band, b.findings.map((f) => f.id)])).toEqual([
      ["zone_0", ["req", "rec"]],
      ["zone_2", ["far"]],
    ]);
  });
});

describe("dates", () => {
  it("says the day walked in full, with its ordinal", () => {
    expect(copy.results.walked(dayOf("2026-10-26"))).toBe("Walked Monday, October 26th, 2026.");
    const days = ["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-11", "2026-11-12", "2026-11-13", "2026-11-21", "2026-11-22", "2026-11-23"];
    expect(days.map((d) => longDate(dayOf(d)).split(" ")[2])).toEqual(["1st,", "2nd,", "3rd,", "4th,", "11th,", "12th,", "13th,", "21st,", "22nd,", "23rd,"]);
  });

  it("refuses a walk date that is not a day", () => {
    expect(() => dayOf("2026-10-26T10:00")).toThrow("YYYY-MM-DD");
    expect(() => dayOf("Oct 26")).toThrow();
  });

  it("is over a year old from the same day a year later", () => {
    expect(overAYearOld("2026-10-26", Date.UTC(2027, 9, 25, 23, 59))).toBe(false);
    expect(overAYearOld("2026-10-26", Date.UTC(2027, 9, 26))).toBe(true);
    expect(overAYearOld("2026-10-26", Date.UTC(2026, 9, 27))).toBe(false);
  });
});

describe("gap lines", () => {
  it("says each gap as what the video lacks, in the settled words", () => {
    expect([
      copy.results.gap({ side: "back", kind: "missing", hint: "walk_side" }),
      copy.results.gap({ side: "left", kind: "dark", hint: "more_light" }),
      copy.results.gap({ side: "right", kind: "first_five_feet", hint: "tilt_down" }),
    ]).toEqual(SETTLED_GAPS);
  });

  it("says a side the check could not finish as still needing a check, never as missing from the video", () => {
    expect(copy.results.gap({ side: "back", kind: "not_checked", hint: "again" })).toBe(SETTLED_SIDE.notChecked);
    expect(SIDES.map((side) => copy.results.walkSide(side))).toEqual(Object.values(SETTLED_SIDE.walk));
  });
});

describe("sidesToWalk", () => {
  const gap = (side: Side, kind: Gap["kind"] = "missing"): Gap => ({ side, kind, hint: HINTS_FOR[kind][0]! });

  it("names each gapped side once, in walking order", () => {
    expect(sidesToWalk([gap("left"), gap("back", "dark"), gap("back", "not_checked"), gap("front")])).toEqual(["front", "back", "left"]);
    expect(sidesToWalk([gap("right", "first_five_feet")])).toEqual(["right"]);
  });

  it("names no side when there is no gap", () => {
    expect(sidesToWalk([])).toEqual([]);
  });

  it("names no side when every side is gapped, so the whole walk is asked for", () => {
    expect(sidesToWalk(SIDES.map((side) => gap(side)))).toEqual([]);
    expect(sidesToWalk([...SIDES.slice(0, 3).map((side) => gap(side)), gap("front", "dark")])).toEqual(["front", "right", "back"]);
  });
});

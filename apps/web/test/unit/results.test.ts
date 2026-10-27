import { describe, expect, it } from "vitest";
import { copy, longDate } from "../../src/copy.ts";
import { bandsOf, blocksGreen, dayOf, fixOrder, overAYearOld, verdictOf } from "../../src/results.ts";
import type { Gap, WalkResults } from "../../src/results.ts";
import { feet, finding, walk } from "./result-fakes.ts";
import { SETTLED_GAPS } from "./settled.ts";

describe("verdictOf", () => {
  it("is incomplete whenever the video has a gap, whatever was found", () => {
    const gap: Gap = { side: "back", kind: "missing" };
    expect(verdictOf(walk([], [gap]))).toEqual({ kind: "incomplete", gaps: [gap] });
    expect(verdictOf(walk([finding("a")], [gap])).kind).toBe("incomplete");
    expect(verdictOf(walk([], [gap]), () => true).kind).toBe("incomplete");
  });

  it("lets every gap block green on its own", () => {
    for (const side of ["front", "right", "back", "left"] as const)
      for (const kind of ["missing", "dark", "first_five_feet"] as const)
        expect(verdictOf(walk([], [{ side, kind }])).kind, `${side} ${kind}`).toBe("incomplete");
  });

  it("is ready only with no gap and nothing blocking", () => {
    expect(verdictOf(walk([]))).toEqual({ kind: "ready" });
    expect(verdictOf(walk([finding("far", { label: "recommended", band: "zone_2", ...feet(40) })]))).toEqual({ kind: "ready" });
    expect(verdictOf(walk([finding("a")])).kind).toBe("fix");
  });

  it("counts at most three items to fix first, Required Now first, then distance", () => {
    const list = [
      finding("rec-near", { label: "recommended", band: "zone_0", ...feet(1) }),
      finding("req-far", feet(20)),
      finding("req-near", feet(6)),
      finding("req-mid", feet(12)),
    ];
    const verdict = verdictOf(walk(list));
    expect(verdict.kind === "fix" && verdict.first.map((f) => f.id)).toEqual(["req-near", "req-mid", "req-far"]);
    const two = verdictOf(walk(list.slice(0, 2)));
    expect(two.kind === "fix" && two.first.map((f) => f.id)).toEqual(["req-far", "rec-near"]);
    const one = verdictOf(walk([list[2]!]));
    expect(one.kind === "fix" && one.first.length).toBe(1);
  });

  it("never puts a Recommended item past five feet in the fix first list", () => {
    const verdict = verdictOf(walk([finding("req"), finding("rec", { label: "recommended", ...feet(8) })]));
    expect(verdict.kind === "fix" && verdict.first.map((f) => f.id)).toEqual(["req"]);
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
      copy.results.gap({ side: "back", kind: "missing" }),
      copy.results.gap({ side: "left", kind: "dark" }),
      copy.results.gap({ side: "right", kind: "first_five_feet" }),
    ]).toEqual(SETTLED_GAPS);
  });
});

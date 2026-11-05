import { describe, expect, it } from "vitest";
import { homeViewOf, newestWalkId } from "../../src/dashboard.ts";
import { NEEDS_FIXING } from "../../src/finding-marks.ts";
import type { FindingStatus } from "../../src/finding-marks.ts";
import { feet, finding, walk } from "./result-fakes.ts";

const statuses = (done: string[]) => (id: string): FindingStatus => (done.includes(id) ? { kind: "done", note: "", recheck: null } : NEEDS_FIXING);

describe("the dashboard's view of the last walk", () => {
  const results = walk([finding("a", feet(3)), finding("b", feet(8)), finding("c", feet(12)), finding("d", feet(20)), finding("e", { ...feet(60), label: "recommended", band: "zone_2" })]);

  it("counts what is left to fix and what is done, and names at most three to fix first, nearest first", () => {
    const view = homeViewOf(results, [], statuses(["b"]));
    expect(view.toFix).toBe(4);
    expect(view.done).toBe(1);
    expect(view.first.map((f) => f.id)).toEqual(["a", "c", "d"]);
    expect(view.next).toEqual({ kind: "after_fixes", day: new Date(Date.UTC(2027, 3, 1, 12)) });
  });

  it("leaves out findings the homeowner removed", () => {
    expect(homeViewOf(results, [{ findingId: "a", atMs: 1 }], statuses([])).toFix).toBe(4);
  });

  it("once the fixes are done, it asks for the after walk now and keeps the yearly day", () => {
    const view = homeViewOf(results, [], statuses(["a", "b", "c", "d"]));
    expect(view.first).toEqual([]);
    expect(view.next).toEqual({ kind: "after_walk", day: new Date(Date.UTC(2027, 3, 1, 12)) });
  });

  it("a walk with nothing to fix is due again on the first of the fire season month", () => {
    const clean = walk([finding("z", { ...feet(60), label: "recommended", band: "zone_2" })]);
    expect(homeViewOf(clean, [], statuses([])).next).toEqual({ kind: "yearly", day: new Date(Date.UTC(2027, 3, 1, 12)) });
  });

  it("a walk made shortly before fire season counts for that season, so the next is due a season later", () => {
    const march = { ...walk([finding("z", { ...feet(60), label: "recommended", band: "zone_2" })]), walkedOn: "2027-03-10" };
    expect(homeViewOf(march, [], statuses([])).next).toEqual({ kind: "yearly", day: new Date(Date.UTC(2028, 3, 1, 12)) });
    for (const [walkedOn, due] of [["2026-11-03", Date.UTC(2027, 3, 1, 12)], ["2027-03-01", Date.UTC(2028, 3, 1, 12)], ["2027-05-10", Date.UTC(2028, 3, 1, 12)]] as const) {
      expect(homeViewOf({ ...march, walkedOn }, [], statuses([])).next.day).toEqual(new Date(due));
    }
    const june = { ...march, walkedOn: "2027-06-10" };
    expect(homeViewOf(june, [], statuses([])).next).toEqual({ kind: "yearly", day: new Date(Date.UTC(2028, 3, 1, 12)) });
  });
});

describe("the newest walk", () => {
  it("picks the latest walk day, and nothing when there is no walk", () => {
    expect(newestWalkId([{ walkId: "old", walkedOn: "2026-10-01" }, { walkId: "new", walkedOn: "2026-11-02" }, { walkId: "mid", walkedOn: "2026-10-20" }])).toBe("new");
    expect(newestWalkId([])).toBeNull();
  });
});

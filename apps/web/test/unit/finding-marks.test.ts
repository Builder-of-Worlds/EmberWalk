import { describe, expect, it } from "vitest";
import { isRechecked, marksKey, NEEDS_FIXING, parseMarks, STATUSES, storageFindingMarks } from "../../src/finding-marks.ts";
import { memoryStorage, refusingStorage } from "./fakes.ts";

describe("finding marks", () => {
  it("removes and restores a finding for one walk only", () => {
    const marks = storageFindingMarks(() => memoryStorage());
    marks.remove("walk-1", "a", 50);
    expect(marks.removed("walk-1")).toEqual([{ findingId: "a", atMs: 50 }]);
    expect(marks.removed("walk-2")).toEqual([]);
    marks.restore("walk-1", "a");
    expect(marks.removed("walk-1")).toEqual([]);
  });

  it("keeps the first removal time and lists removals oldest first", () => {
    const marks = storageFindingMarks(() => memoryStorage());
    marks.remove("walk-1", "late", 30);
    marks.remove("walk-1", "early", 10);
    marks.remove("walk-1", "middle", 20);
    marks.remove("walk-1", "late", 99);
    expect(marks.removed("walk-1")).toEqual([
      { findingId: "early", atMs: 10 },
      { findingId: "middle", atMs: 20 },
      { findingId: "late", atMs: 30 },
    ]);
  });

  it("restoring a finding that was never removed changes nothing", () => {
    const storage = memoryStorage();
    const marks = storageFindingMarks(() => storage);
    marks.remove("walk-1", "a", 5);
    marks.restore("walk-1", "b");
    expect(marks.removed("walk-1")).toEqual([{ findingId: "a", atMs: 5 }]);
    expect(storageFindingMarks(() => storage).removed("walk-1")).toEqual([{ findingId: "a", atMs: 5 }]);
  });

  it("survives a new store on the same storage, under the walk's own key", () => {
    const storage = memoryStorage();
    storageFindingMarks(() => storage).remove("walk-1", "a", 7);
    expect(storage.getItem(marksKey("walk-1"))).not.toBeNull();
    expect(storage.getItem(marksKey("walk-2"))).toBeNull();
    const again = storageFindingMarks(() => storage);
    expect(again.removed("walk-1")).toEqual([{ findingId: "a", atMs: 7 }]);
    again.restore("walk-1", "a");
    expect(storageFindingMarks(() => storage).removed("walk-1")).toEqual([]);
  });

  it("keeps removals in memory when storage is refused", () => {
    const marks = storageFindingMarks(refusingStorage);
    marks.remove("walk-1", "a", 3);
    expect(marks.removed("walk-1")).toEqual([{ findingId: "a", atMs: 3 }]);
    marks.restore("walk-1", "a");
    expect(marks.removed("walk-1")).toEqual([]);
  });

  it("reads junk as nothing removed, and drops entries without a usable time", () => {
    for (const text of [null, "", "{", "[]", "null", "7", '{"removed":[]}', '{"removed":null}', '{"other":{}}', '{"status":[]}']) {
      expect(parseMarks(text), String(text)).toEqual({ removed: {}, status: {} });
    }
    expect(parseMarks('{"removed":{"a":4,"b":"4","c":null,"d":1e999}}')).toEqual({ removed: { a: 4 }, status: {} });
    const storage = memoryStorage();
    storage.setItem(marksKey("walk-1"), "not json");
    expect(storageFindingMarks(() => storage).removed("walk-1")).toEqual([]);
  });
});

const RECHECK = { photo: "recheck/a.jpg", atMs: Date.UTC(2026, 10, 2, 12) };

const withStatus = (status: Record<string, unknown>) => {
  const storage = memoryStorage();
  storage.setItem(marksKey("walk-1"), JSON.stringify({ removed: {}, status }));
  return storageFindingMarks(() => storage);
};

describe("finding status", () => {
  it("starts at Needs Fixing, moves through Fix Planned with a trimmed note and Done, and back", () => {
    const marks = storageFindingMarks(() => memoryStorage());
    expect(marks.statusOf("walk-1", "a")).toEqual(NEEDS_FIXING);
    marks.setStatus("walk-1", "a", "fix_planned", "  tree crew Saturday ");
    expect(marks.statusOf("walk-1", "a")).toEqual({ kind: "fix_planned", note: "tree crew Saturday", recheck: null });
    expect(marks.statusOf("walk-1", "b")).toEqual(NEEDS_FIXING);
    expect(marks.statusOf("walk-2", "a")).toEqual(NEEDS_FIXING);
    marks.setStatus("walk-1", "a", "done", "ignored");
    expect(marks.statusOf("walk-1", "a")).toEqual({ kind: "done", note: "", recheck: null });
    marks.setStatus("walk-1", "a", "needs_fixing");
    expect(marks.statusOf("walk-1", "a")).toEqual(NEEDS_FIXING);
  });

  it("is never Rechecked by setting a status, only by a stored recheck photo on a Done item", () => {
    const marks = storageFindingMarks(() => memoryStorage());
    for (const kind of STATUSES) {
      marks.setStatus("walk-1", "a", kind, "note");
      expect(isRechecked(marks.statusOf("walk-1", "a")), kind).toBe(false);
    }
    expect(isRechecked(withStatus({ a: { kind: "done", recheck: RECHECK } }).statusOf("walk-1", "a"))).toBe(true);
    expect(isRechecked(withStatus({ a: { kind: "fix_planned", recheck: RECHECK } }).statusOf("walk-1", "a"))).toBe(false);
    for (const recheck of [null, {}, { photo: "", atMs: 1 }, { photo: "p.jpg" }, { photo: "p.jpg", atMs: "1" }, { photo: 3, atMs: 1 }]) {
      expect(withStatus({ a: { kind: "done", recheck } }).statusOf("walk-1", "a"), JSON.stringify(recheck)).toEqual({ kind: "done", note: "", recheck: null });
    }
  });

  it("keeps a recheck when Done is chosen again, and drops it on any other status", () => {
    const marks = withStatus({ a: { kind: "done", recheck: RECHECK } });
    marks.setStatus("walk-1", "a", "done");
    expect(marks.statusOf("walk-1", "a")).toEqual({ kind: "done", note: "", recheck: RECHECK });
    marks.setStatus("walk-1", "a", "fix_planned");
    marks.setStatus("walk-1", "a", "done");
    expect(isRechecked(marks.statusOf("walk-1", "a"))).toBe(false);
  });

  it("survives a new store on the same storage, beside the removals, and lives in memory when storage is refused", () => {
    const storage = memoryStorage();
    const marks = storageFindingMarks(() => storage);
    marks.remove("walk-1", "b", 9);
    marks.setStatus("walk-1", "a", "fix_planned", "crew");
    const again = storageFindingMarks(() => storage);
    expect(again.statusOf("walk-1", "a")).toEqual({ kind: "fix_planned", note: "crew", recheck: null });
    expect(again.removed("walk-1")).toEqual([{ findingId: "b", atMs: 9 }]);
    const refused = storageFindingMarks(refusingStorage);
    refused.setStatus("walk-1", "a", "done");
    expect(refused.statusOf("walk-1", "a").kind).toBe("done");
  });

  it("reads an unknown kind or a stray note as nothing set", () => {
    const marks = withStatus({ a: { kind: "rechecked" }, b: "done", c: { kind: "done", note: "x" }, d: { kind: "fix_planned", note: 4 }, toString: { kind: "done" } });
    expect(marks.statusOf("walk-1", "a")).toEqual(NEEDS_FIXING);
    expect(marks.statusOf("walk-1", "b")).toEqual(NEEDS_FIXING);
    expect(marks.statusOf("walk-1", "c")).toEqual({ kind: "done", note: "", recheck: null });
    expect(marks.statusOf("walk-1", "d")).toEqual({ kind: "fix_planned", note: "", recheck: null });
    expect(marks.statusOf("walk-1", "constructor")).toEqual(NEEDS_FIXING);
  });
});

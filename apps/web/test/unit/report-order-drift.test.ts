import { describe, expect, it } from "vitest";
import { LOOP_CONCEPTS } from "@emberwalk/shared";
import { reportOn } from "../../src/deps.ts";
import { reportOrder } from "../../../../workers/api/src/report.ts";
import { reportWords } from "../../../../workers/api/src/report-words.ts";
import { copy } from "../../src/copy.ts";
import { bandsOf, verdictOf } from "../../src/results.ts";
import type { Gap, Label, ResultFinding } from "../../src/results.ts";
import { finding, walk } from "./result-fakes.ts";

type Spec = { id: string; low: number; high: number; label: Label; band: ResultFinding["band"] };

const SPECS: Spec[] = [
  { id: "m", low: 5, high: 5, label: "required_now", band: "zone_1" },
  { id: "far", low: 30, high: 30, label: "required_now", band: "zone_2" },
  { id: "a", low: 5, high: 5, label: "recommended", band: "zone_1" },
  { id: "c", low: 5, high: 5, label: "required_now", band: "zone_1" },
  { id: "b", low: 5, high: 9, label: "required_now", band: "zone_1" },
  { id: "edge", low: 29.9, high: 31, label: "recommended", band: "zone_2" },
  { id: "z", low: 0, high: 2, label: "recommended", band: "zone_0" },
  { id: "x", low: 60, high: 70, label: "recommended", band: "zone_2" },
];

const findings = (specs: Spec[]) => specs.map((s) => finding(s.id, { distanceFeet: { low: s.low, high: s.high }, label: s.label, band: s.band }));

const appOrder = (list: ResultFinding[], cleared: (f: ResultFinding) => boolean) => {
  const verdict = verdictOf(walk(list), cleared);
  const first = verdict.kind === "fix" ? verdict.first : [];
  return { first: first.map((f) => f.id), bands: bandsOf(list.filter((f) => !first.includes(f))).map((b) => [b.band, b.findings.map((f) => f.id)]) };
};

const reportsOrder = (list: ResultFinding[], cleared: (f: ResultFinding) => boolean) => {
  const order = reportOrder({ findings: list.map((f) => ({ ...f, voiceNote: f.voiceNote ?? null })), gaps: [] }, (f) => cleared(list.find((g) => g.id === f.id)!));
  return { first: order.first.map((f) => f.id), bands: order.bands.map((b) => [b.band, b.findings.map((f) => f.id)]) };
};

describe("the report's fix first order and the results screen's", () => {
  it("are the same list, then the same bands, on the same findings", () => {
    const list = findings(SPECS);
    expect(reportsOrder(list, () => false)).toEqual(appOrder(list, () => false));
    expect(reportsOrder(list, () => false).first).toEqual(["z", "c", "m", "a", "b", "edge"]);
  });

  it("stay the same when a cleared item leaves the list", () => {
    const list = findings(SPECS);
    const cleared = (f: ResultFinding) => f.id === "c" || f.id === "z";
    expect(reportsOrder(list, cleared)).toEqual(appOrder(list, cleared));
  });

  it("stay the same when the walk has gaps: a missing side empties the list, a corner gap alone does not", () => {
    const list = findings(SPECS);
    for (const gaps of [[{ side: "back", kind: "missing", hint: "walk_side" }], [{ side: "back_left", kind: "missing", hint: "pan_corner" }]] satisfies Gap[][]) {
      const app = verdictOf({ ...walk(list), gaps }, () => false);
      const report = reportOrder({ findings: list.map((f) => ({ ...f, voiceNote: f.voiceNote ?? null })), gaps }, () => false);
      expect(report.first.map((f) => f.id)).toEqual(app.kind === "fix" ? app.first.map((f) => f.id) : []);
    }
    expect(reportOrder({ findings: list.map((f) => ({ ...f, voiceNote: f.voiceNote ?? null })), gaps: [{ side: "back_left", kind: "missing", hint: "pan_corner" }] }, () => false).first).not.toEqual([]);
  });

  it("stay the same when only far findings block", () => {
    const list = findings(SPECS.filter((s) => s.id === "far" || s.id === "x"));
    expect(reportsOrder(list, () => false)).toEqual(appOrder(list, () => false));
    expect(reportsOrder(list, () => false).first).toEqual(["far"]);
  });
});

describe("the report's words and the app's", () => {
  it("name every thing not checked the same way", () => {
    for (const concept of LOOP_CONCEPTS) expect(reportWords.notChecked(concept)).toBe(copy.results.notChecked(concept));
  });
});

describe("the report flag", () => {
  it("is on only for the exact word on", () => {
    expect(reportOn("on")).toBe(true);
    for (const raw of [undefined, "", "off", "ON", "true", "1", " on"]) expect(reportOn(raw)).toBe(false);
  });
});

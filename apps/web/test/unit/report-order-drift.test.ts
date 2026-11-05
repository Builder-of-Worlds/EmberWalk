import { describe, expect, it } from "vitest";
import { CORNERS, GAP_KINDS, LOOP_CONCEPTS } from "@emberwalk/shared";
import { reportOrder } from "../../../../workers/api/src/report.ts";
import { reportWords } from "../../../../workers/api/src/report-words.ts";
import { copy, draft } from "../../src/copy.ts";
import { bandsOf, firstOf, verdictOf } from "../../src/results.ts";
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

  it("stay the same when the walk has gaps: a missing side or a corner keeps every open finding inside 30 feet first", () => {
    const cases = [findings(SPECS), findings(SPECS.filter((s) => s.id === "far" || s.id === "x"))];
    for (const list of cases)
      for (const gaps of [[{ side: "back", kind: "missing", hint: "walk_side" }], [{ side: "back_left", kind: "missing", hint: "pan_corner" }]] satisfies Gap[][]) {
        const cleared = (f: ResultFinding) => f.id === "c";
        const app = verdictOf({ ...walk(list), gaps }, cleared);
        const report = reportOrder({ findings: list.map((f) => ({ ...f, voiceNote: f.voiceNote ?? null })), gaps }, (f) => cleared(list.find((g) => g.id === f.id)!));
        expect(app.kind).toBe("incomplete");
        expect(report.first.map((f) => f.id)).toEqual(firstOf(app, list, cleared).map((f) => f.id));
      }
    const near = findings(SPECS);
    const gapped = reportOrder({ findings: near.map((f) => ({ ...f, voiceNote: f.voiceNote ?? null })), gaps: [{ side: "back_left", kind: "missing", hint: "pan_corner" }] }, () => false);
    expect(gapped.first.map((f) => f.id)).toEqual(["z", "c", "m", "a", "b", "edge"]);
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
  it("name every corner gap the same way", () => {
    for (const corner of CORNERS) for (const kind of GAP_KINDS) expect(reportWords.cornerGap[kind](corner)).toBe(draft.corners.gap[kind](corner));
  });
});

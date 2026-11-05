import { describe, expect, it } from "vitest";
import { sampleOf } from "../../src/live/sample-fixture.ts";

const finding = (id: string) => ({ id, preview: `/api/walks/w/previews/${id}`, proof: { still: `/api/walks/w/stills/${id}`, frame: 3, seconds: 1.5, marker: [0.1, 0.2, 0.3, 0.4] } });
const run = { id: "walk-id", synthetic: true, walkedOn: "2026-11-01", pins: [{ findingId: "a", side: "left", band: "zone_0", position: 0.5, feet: 2 }], findings: [finding("a"), finding("b")] };
const stills = { a: "1-a.jpg", b: "2-b.jpg" };

describe("the sample made from a run", () => {
  it("takes the sample's id and keeps the run's pins and places", () => {
    const sample = sampleOf(run, "sample-hero-before", stills, new Set());
    expect(sample.id).toBe("sample-hero-before");
    expect(sample.pins).toEqual(run.pins);
    expect(sample.findings[0]!.proof).toEqual({ ...run.findings[0]!.proof, still: "1-a.jpg" });
  });

  it("names a finding's still by the file written beside it, not the walk's link", () => {
    const sample = sampleOf(run, "sample-hero-before", stills, new Set());
    expect(sample.findings.map((f) => f.proof.still)).toEqual(["1-a.jpg", "2-b.jpg"]);
  });

  it("keeps a preview only where a preview file was written", () => {
    const sample = sampleOf(run, "sample-hero-before", stills, new Set(["a"]));
    expect(sample.findings.map((f) => f.preview)).toEqual(["/api/walks/w/previews/a", null]);
  });

  it("refuses a finding whose still was not written", () => {
    expect(() => sampleOf(run, "sample-hero-before", { a: "1-a.jpg" }, new Set())).toThrow(/b/);
  });

  it("refuses a run not marked synthetic", () => {
    expect(() => sampleOf({ ...run, synthetic: false }, "sample-hero-before", stills, new Set())).toThrow(/synthetic/);
  });
});

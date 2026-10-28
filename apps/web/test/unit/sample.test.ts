import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreWalk, WalkRecord } from "@emberwalk/rules";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { proofOf, REPO, SAMPLE, sampleResults } from "../../scripts/sample-results.ts";
import { App } from "../../src/App.tsx";
import { copy } from "../../src/copy.ts";
import { verdictOf } from "../../src/results.ts";
import { findingFor, resultsFor } from "../../src/router.ts";
import { SAMPLES, sampleResults as bundledResults, syntheticOnly } from "../../src/samples.ts";
import { testDeps } from "./fakes.ts";
import { render, settle } from "./render.ts";
import { NEVER_LABELLED } from "./settled.ts";

const SAMPLE_DIR = resolve(REPO, "apps/web/src/samples");
const committed = JSON.parse(readFileSync(resolve(SAMPLE_DIR, "test-yard.json"), "utf8"));
const sam = WalkRecord.parse(JSON.parse(readFileSync(resolve(REPO, SAMPLE.sam), "utf8")));
const RENDER = { synthetic: true, label: "Synthetic sample house", scene: "test-yard", width: 1920, height: 1080 };

describe("the test yard sample", () => {
  it("is exactly what the rules engine makes of the recorded SAM answers", () => {
    expect(sampleResults()).toEqual(committed);
  });

  it("keeps only the hazards SAM found in the recording, with their rules", () => {
    const found = scoreWalk(sam).filter((s) => s.found).map((s) => s.id);
    expect(found).toEqual(["wood-pile-1"]);
    const results = sampleResults();
    expect(results.findings.map((f) => [f.id, f.band, f.label, f.sources.map((s) => s.citation)])).toEqual([
      ["wood-pile-1", "zone_0", "required_now", ["14 CCR 1299.03(a)(3)", "CAL FIRE Zone 0 guidance"]],
    ]);
    expect(results.findings[0]!.confidence).toBe(1);
  });

  it("is incomplete, because the render films the back side only", () => {
    const results = sampleResults();
    expect(results.synthetic).toBe(true);
    expect(results.gaps).toEqual([
      { side: "front", kind: "missing", hint: "walk_side" },
      { side: "right", kind: "missing", hint: "walk_side" },
      { side: "left", kind: "missing", hint: "walk_side" },
    ]);
    expect(verdictOf({ ...results, coverage: "checked", notChecked: [] }).kind).toBe("incomplete");
  });

  it("shows each finding on the SAM frame that fits the truth best, marked by SAM's own box", () => {
    const proof = proofOf(sam.hazards[0]!, RENDER);
    expect(proof).toEqual({ still: "wood-pile-1.jpg", frame: 1, seconds: 0.5, marker: [0, 0.1426, 0.3776, 0.6148] });
    const one = { ...sam.hazards[0]!, found: [sam.hazards[0]!.found[3]!] };
    expect(proofOf(one, RENDER).frame).toBe(3);
    const twoBoxes = { ...one, found: [{ frame: 3, boxes: [[0, 0, 10, 10] as [number, number, number, number], one.found[0]!.boxes[0]!] }] };
    expect(proofOf(twoBoxes, RENDER).marker).toEqual(proofOf(one, RENDER).marker);
  });

  it("refuses a hazard with no frame to show", () => {
    expect(() => proofOf({ ...sam.hazards[0]!, found: [] }, RENDER)).toThrow("no frame to show");
  });

  it("bundles a still for every finding and serves it from the app", () => {
    for (const f of committed.findings) expect(existsSync(resolve(SAMPLE_DIR, f.proof.still)), f.proof.still).toBe(true);
    expect(SAMPLES.map((s) => s.id)).toEqual([SAMPLE.id]);
    for (const f of SAMPLES[0]!.findings) expect(f.proof.still).not.toBe("wood-pile-1.jpg");
  });
});

const until = async (check: () => boolean) => {
  for (let i = 0; i < 50 && !check(); i++) await settle(() => new Promise((r) => setTimeout(r, 5)));
  if (!check()) throw new Error("condition never became true");
};

const shown = async (hash: string) => {
  window.location.hash = hash;
  const view = await render(createElement(App, { deps: testDeps({ results: bundledResults }) }));
  await until(() => view.host.querySelector("main.results, main.one-finding") !== null);
  return view;
};

afterEach(() => {
  window.location.hash = "";
  document.body.replaceChildren();
});

describe("every bundled sample", () => {
  it("is marked synthetic in its data, and its results and finding screens never say so, in both views (D-177)", async () => {
    expect(SAMPLES.length).toBeGreaterThan(0);
    for (const sample of SAMPLES) {
      expect(sample.synthetic).toBe(true);
      const results = await shown(resultsFor(sample.id));
      for (const chosen of [copy.results.detailed, copy.results.simple]) {
        const button = [...results.host.querySelectorAll("button")].find((b) => b.textContent === chosen);
        await settle(() => button?.click());
        expect(results.host.querySelector("h1")?.textContent).toBe(copy.results.incomplete);
        expect(results.text()).not.toMatch(NEVER_LABELLED);
      }
      await results.unmount();
      for (const finding of sample.findings) {
        const one = await shown(findingFor(sample.id, finding.id));
        expect(one.host.querySelector("p.sentence")?.textContent).toBe(finding.instruction);
        expect(one.text()).not.toMatch(NEVER_LABELLED);
        await one.unmount();
      }
    }
  });

  it("refuses a sample not marked synthetic, naming it", () => {
    const sample = SAMPLES[0]!;
    expect(() => syntheticOnly([{ ...sample, synthetic: false }])).toThrow(sample.id);
    expect(() => syntheticOnly([sample, { ...sample, id: "second", synthetic: false }])).toThrow("second");
    expect(syntheticOnly([sample])).toEqual([sample]);
  });
});

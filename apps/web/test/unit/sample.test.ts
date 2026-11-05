import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { scoreWalk, WalkRecord } from "@emberwalk/rules";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { REPO, SAMPLE, sampleResults } from "../../scripts/sample-results.ts";
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
const HERO_DIR = resolve(REPO, "fixtures/synthetic/hero-look");
const HERO_PHOTOS: string[] = JSON.parse(readFileSync(resolve(HERO_DIR, "look.json"), "utf8"))
  .stills.filter((s: { chosen?: boolean }) => s.chosen === true)
  .map((s: { copy: { file: string } }) => s.copy.file);

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

  it("outlines every finding inside one of the chosen hero look photos", () => {
    expect(committed.findings.length).toBeGreaterThan(0);
    for (const f of committed.findings) {
      expect(HERO_PHOTOS, f.proof.still).toContain(f.proof.still);
      expect(existsSync(resolve(HERO_DIR, f.proof.still)), f.proof.still).toBe(true);
      const [left, top, right, bottom] = f.proof.marker as number[];
      expect(left, f.id).toBeGreaterThanOrEqual(0);
      expect(top, f.id).toBeGreaterThanOrEqual(0);
      expect(right, f.id).toBeLessThanOrEqual(1);
      expect(bottom, f.id).toBeLessThanOrEqual(1);
      expect(right! - left!, f.id).toBeGreaterThan(0.05);
      expect(bottom! - top!, f.id).toBeGreaterThan(0.05);
    }
  });

  it("serves a hero look photo for every finding and no old render", () => {
    expect(SAMPLES.map((s) => s.id)).toEqual([SAMPLE.id]);
    expect(existsSync(resolve(SAMPLE_DIR, "wood-pile-1.jpg"))).toBe(false);
    for (const f of SAMPLES[0]!.findings) {
      const name = f.proof.still.split("/").pop()!.split("?")[0]!;
      expect(HERO_PHOTOS, f.proof.still).toContain(name);
    }
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
  it("is marked synthetic in its data, and its results and finding screens never say so, in both views", async () => {
    expect(SAMPLES.length).toBeGreaterThan(0);
    for (const sample of SAMPLES) {
      expect(sample.synthetic).toBe(true);
      const results = await shown(resultsFor(sample.id));
      for (const chosen of [copy.results.detailed, copy.results.simple]) {
        const button = [...results.host.querySelectorAll("button")].find((b) => b.textContent === chosen);
        await settle(() => button?.click());
        expect(results.host.querySelector("h1")?.textContent).toBe(copy.sample.partial);
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

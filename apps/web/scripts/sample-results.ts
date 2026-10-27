import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Concept } from "@emberwalk/shared";
import { evaluate, iou, rank, RULES, scoreWalk, WalkRecord } from "@emberwalk/rules";
import type { HazardRecord, Observation, Rect } from "@emberwalk/rules";
import type { Marker, Proof, ResultFinding, Side, Source, WalkResults } from "../src/results.ts";
import { SIDES } from "../src/results.ts";

export const SAMPLE = {
  id: "sample-test-yard",
  walkedOn: "2026-10-26",
  jurisdiction: "ca",
  truth: "fixtures/synthetic/test-yard/truth.json",
  render: "fixtures/synthetic/test-yard/render.json",
  sam: "packages/rules/test/fixtures/test-yard-sam-017.json",
  samFps: 2,
} as const;

type TruthHazard = { id: string; concept: string; distance_ft: number; contact: boolean };
type Truth = { synthetic: boolean; label: string; scene: string; side: Side; hazards: TruthHazard[] };
type Render = { synthetic: boolean; label: string; scene: string; width: number; height: number };

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

const read = <T>(path: string): T => JSON.parse(readFileSync(resolve(REPO, path), "utf8")) as T;

const fraction = (value: number, of: number) => Math.round((value / of) * 10_000) / 10_000;

export const proofOf = (hazard: HazardRecord, render: Render): Proof => {
  const best = hazard.found
    .map(({ frame, boxes }) => {
      const truth = hazard.truth[String(frame)];
      const box = [...boxes].sort((a, b) => (truth ? iou(b, truth) - iou(a, truth) : 0))[0]!;
      return { frame, box, fit: truth ? iou(box, truth) : 0 };
    })
    .sort((a, b) => b.fit - a.fit || a.frame - b.frame)[0];
  if (best === undefined) throw new Error(`${hazard.id} has no frame to show`);
  const [l, t, r, b] = best.box as Rect;
  const marker: Marker = [fraction(l, render.width), fraction(t, render.height), fraction(r, render.width), fraction(b, render.height)];
  return { still: `${hazard.id}.jpg`, frame: best.frame, seconds: best.frame / SAMPLE.samFps, marker };
};

const sourcesOf = (ruleIds: string[]): Source[] => {
  const seen = new Map<string, Source>();
  for (const id of ruleIds) {
    const rule = RULES.find((r) => r.id === id);
    if (rule === undefined) throw new Error(`no rule ${id}`);
    if (!seen.has(rule.citation))
      seen.set(rule.citation, { citation: rule.citation, words: rule.requirement, status: rule.status, url: rule.sourceUrl, retrievedOn: rule.retrievedOn });
  }
  return [...seen.values()];
};

export const sampleResults = (): Omit<WalkResults, "coverage" | "notChecked"> => {
  const truth = read<Truth>(SAMPLE.truth);
  const render = read<Render>(SAMPLE.render);
  const sam = WalkRecord.parse(read(SAMPLE.sam));
  for (const file of [truth, render])
    if (!file.synthetic || file.label !== "Synthetic sample house" || file.scene !== render.scene) throw new Error("the sample must be one labelled synthetic scene");
  const found = scoreWalk(sam).filter((s) => s.found);
  const observations: Observation[] = found.map((s) => {
    const hazard = truth.hazards.find((h) => h.id === s.id);
    if (hazard === undefined) throw new Error(`${s.id} is not in the truth file`);
    const share = s.hits / s.window;
    return {
      id: s.id,
      concept: Concept.parse(hazard.concept.replaceAll(" ", "_")),
      distanceFeet: { low: hazard.distance_ft, high: hazard.distance_ft },
      contact: hazard.contact ? "yes" : "no",
      plantState: null,
      spacing: null,
      flags: [],
      frameShare: share,
      confidence: share,
    };
  });
  const findings: ResultFinding[] = rank(evaluate(observations, SAMPLE.jurisdiction)).map((f) => {
    const record = sam.hazards.find((h) => h.id === f.observationId)!;
    const seen = observations.find((o) => o.id === f.observationId)!;
    return {
      id: f.observationId,
      concept: f.concept,
      band: f.band,
      distanceFeet: seen.distanceFeet,
      label: f.label,
      instruction: f.instruction,
      sources: sourcesOf(f.ruleIds),
      confidence: f.confidence,
      proof: proofOf(record, render),
    };
  });
  const gaps = SIDES.filter((side) => side !== truth.side).map((side) => ({ side, kind: "missing" as const }));
  return { id: SAMPLE.id, walkedOn: SAMPLE.walkedOn, synthetic: true, gaps, findings };
};
